#!/usr/bin/env python3
"""Dependency-light browser E2E checks using headless Chrome's DevTools protocol."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import time
from collections import Counter
from pathlib import Path
from urllib.request import Request, urlopen
import re

import websocket


PROJECT = Path(__file__).resolve().parents[1]


def free_ports(count: int) -> list[int]:
    """Allocate distinct ephemeral ports while all reservation sockets are open."""
    sockets: list[socket.socket] = []
    try:
        for _ in range(count):
            sock = socket.socket()
            sock.bind(("127.0.0.1", 0))
            sockets.append(sock)
        return [int(sock.getsockname()[1]) for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()
def wait_http(url: str, timeout: float = 15.0) -> bytes:
    deadline = time.monotonic() + timeout
    failure: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=1) as response:
                return response.read()
        except Exception as cause:  # pragma: no cover - diagnostic path
            failure = cause
            time.sleep(0.1)
    raise RuntimeError(f"Timed out waiting for {url}: {failure}")


class ChromePage:
    def __init__(self, websocket_url: str):
        self.socket = websocket.create_connection(websocket_url, timeout=15, origin="http://localhost")
        self.next_id = 0
        self.events: list[dict] = []

    def close(self) -> None:
        self.socket.close()

    def call(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        message_id = self.next_id
        self.socket.send(json.dumps({"id": message_id, "method": method, "params": params or {}}))
        while True:
            result = json.loads(self.socket.recv())
            if result.get("id") == message_id:
                if "error" in result:
                    raise RuntimeError(f"CDP {method} failed: {result['error']}")
                return result.get("result", {})
            self.events.append(result)

    def evaluate(self, expression: str):
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result["result"].get("value")

    def navigate(self, url: str) -> None:
        self.call("Page.navigate", {"url": url})
        self.wait("document.readyState === 'complete'")

    def wait(self, expression: str, timeout: float = 20.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                value = self.evaluate(expression)
                if value:
                    return value
            except RuntimeError:
                pass
            time.sleep(0.1)
        page_text = self.evaluate("document.body?.innerText?.slice(0, 2000) || ''")
        exceptions = [event for event in self.events if event.get("method") == "Runtime.exceptionThrown"]
        raise AssertionError(
            f"Browser condition timed out: {expression}\n"
            f"Page text:\n{page_text}\n"
            f"Runtime exceptions:\n{json.dumps(exceptions[-3:], indent=2)}"
        )

    def click_text(self, selector: str, text: str) -> None:
        encoded = json.dumps(text)
        result = self.evaluate(
            f"(() => {{ const node=[...document.querySelectorAll({json.dumps(selector)})].find(n=>n.textContent.includes({encoded})); if(!node) return false; node.click(); return true; }})()"
        )
        assert result, f"Could not find {selector} containing {text!r}"


def open_testing_chooser(page: ChromePage, base_url: str, trials: int) -> None:
    page.navigate(f"{base_url}testing/?trials={trials}")
    page.wait("document.querySelector('h1')?.textContent.includes('Visual Perception Study') || document.querySelectorAll('.test-choice-card').length === 4")
    if page.evaluate("document.querySelectorAll('.test-choice-card').length === 4"):
        return
    page.evaluate("document.querySelector('[role=checkbox]').click()")
    page.click_text("button", "Continue")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Skip for testing'))")
    page.click_text("button", "Skip for testing")
    page.wait("document.querySelector('h1')?.textContent.includes('Glossiness and metallicness')")
    page.click_text("button", "Choose a test")
    page.wait("document.querySelectorAll('.test-choice-card').length === 4")


def assert_trial_fits(page: ChromePage, label: str) -> None:
    assert page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 && document.querySelector('.constancy-actions').getBoundingClientRect().bottom <= innerHeight + 1"), f"{label} must fit inside the viewport without scrolling"


def run_checks(page: ChromePage, base_url: str) -> None:
    page.navigate(base_url)
    page.wait("document.querySelector('h1')?.textContent.includes('Open a valid study link')")
    assert not page.evaluate("Boolean(document.querySelector('.consent-row'))"), "The root route must not enter the study"

    page.navigate(f"{base_url}inhouse/")
    page.wait("document.querySelector('h1')?.textContent.includes('In-house access')")
    assert not page.evaluate("Boolean(document.querySelector('.consent-row'))"), "The in-house route must require its access code"
    page.evaluate("(() => { const field=document.querySelector('.participant-login-form input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(field,'gilab-inhouse'); field.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('form').requestSubmit(); })()")
    page.wait("document.querySelector('h1')?.textContent.includes('Visual Perception Study')")
    assert page.evaluate("Boolean(document.querySelector('.consent-row'))"), "The in-house route did not open the welcome screen"
    assert page.evaluate("(() => { const body=window.__loginBodies[window.__loginBodies.length-1]; return body?.username === 'gilab-inhouse' && body?.studyType === 'pairJudgment' && Boolean(body?.inhouseRunId); })()"), "The in-house route did not authenticate the linked four-test flow"

    page.navigate(f"{base_url}preview/")
    page.wait("document.querySelector('h1')?.textContent.includes('Visual Perception Study')")
    assert page.evaluate("Boolean(document.querySelector('.consent-row'))"), "The preview route must retain the study preview"
    page.evaluate("document.querySelector('[role=checkbox]').click()")
    page.click_text("button", "Continue")
    page.wait("document.querySelector('h1')?.textContent.includes('Participant information')")
    page.evaluate("document.querySelectorAll('.demographic-field').forEach(f=>f.querySelector('[role=radio]')?.click())")
    page.evaluate("document.querySelectorAll('.demographic-text-field select').forEach(i=>{const s=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;s.call(i,i.options[1].value);i.dispatchEvent(new Event('change',{bubbles:true}));})")
    page.click_text(".demographic-option", "None of the above")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Continue')&&!b.disabled)")
    page.click_text("button", "Continue")
    page.wait("document.querySelector('h1')?.textContent.includes('Glossiness and metallicness')")
    page.click_text("button", "Choose a test")
    page.wait("document.querySelectorAll('.test-choice-card').length === 4")
    page.evaluate("document.querySelectorAll('.test-choice-card')[1].click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
    page.click_text("button", "Start test")
    # Sentinels occupy trials 2 and 4. Deliberately fail both to inspect the
    # screen-out UI without sending any preview data to D1.
    for option_index in (0, 1, 0, 0):
        page.wait("document.querySelectorAll('.forced-choice-card').length === 2")
        page.evaluate(f"document.querySelectorAll('.forced-choice-card')[{option_index}].click()")
        page.click_text("button", "Next trial")
    page.wait("document.querySelector('h1')?.textContent.includes('You did not pass the attention test')")
    assert page.evaluate("document.body.innerText.includes('CQP8FXQQ')"), "Preview screen-out did not load the configured code"
    assert not page.evaluate("document.body.innerText.includes('Screening receipt')"), "Screen-out exposed the internal screening receipt"
    assert not page.evaluate("document.body.innerText.includes('Private backup receipt')"), "Screen-out exposed an internal fallback receipt"
    page.evaluate("localStorage.clear()")

    production_url = f"{base_url}test4_mm/?PROLIFIC_PID=e2e-participant&STUDY_ID=e2e-study&SESSION_ID=e2e-session"
    page.navigate(production_url)
    page.wait("document.querySelector('h1')?.textContent.includes('Participant access')")
    # The compiled Worker endpoint must keep authentication/submission working
    # even when a stale deployment omits apiBaseUrl from runtime config.js.
    page.evaluate("delete window.USER_STUDY_CONFIG.apiBaseUrl")
    assert page.evaluate("document.querySelectorAll('.participant-login-form input').length") == 1
    page.evaluate("(() => { const field=document.querySelector('.participant-login-form input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(field,'e2e-user'); field.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('form').requestSubmit(); })()")
    page.wait("document.querySelector('h1')?.textContent.includes('Visual Perception Study')")
    page.evaluate("document.querySelector('[role=checkbox]').click()")
    page.click_text("button", "Continue")
    page.wait("document.querySelector('h1')?.textContent.includes('Participant information')")
    assert not page.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Skip for testing'))"), "Testing skip leaked into production mode"
    assert not page.evaluate("[...document.querySelectorAll('.demographic-text-field > span')].some(n=>['Name','Email address','Age','Native language','Country of origin'].includes(n.textContent))"), "Private in-house fields leaked into the Prolific form"

    page.evaluate("document.querySelectorAll('.demographic-field').forEach(f=>f.querySelector('[role=radio]')?.click())")
    page.evaluate("document.querySelectorAll('.demographic-text-field select').forEach(i=>{const s=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;s.call(i,i.options[1].value);i.dispatchEvent(new Event('change',{bubbles:true}));})")
    page.click_text(".demographic-option", "None of the above")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Continue')&&!b.disabled)")
    page.click_text("button", "Continue")
    page.wait("document.querySelector('h1')?.textContent.includes('Glossiness and metallicness')")
    assert page.evaluate("window.__demographicsBodies.length === 1"), "Demographics were not saved before leaving the form"
    assert page.evaluate("window.__demographicsBodies[0].studyType === 'selection' && window.__demographicsBodies[0].demographics.backgroundExperience.includes('none')"), "The demographic checkpoint payload is incomplete"
    page.click_text("button", "Continue to test")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
    page.click_text("button", "Start test")
    page.wait("document.querySelectorAll('.selection-candidate').length === 6")
    assert_trial_fits(page, "Test 4")
    assert page.evaluate("(() => { const reference=document.querySelector('.selection-reference > button').getBoundingClientRect(); const option=document.querySelector('.selection-candidate').getBoundingClientRect(); return Math.abs(reference.width-option.width)<1 && Math.abs(reference.height-option.height)<1; })()"), "Test-4 reference and options must have the same rendered size"

    for candidate_index in range(3):
        page.evaluate(f"document.querySelectorAll('.selection-candidate')[{candidate_index}].click()")
        page.wait(f"document.querySelectorAll('.selection-candidate[aria-pressed=true]').length === {min(candidate_index + 1, 2)}")
    assert page.evaluate("document.querySelectorAll('.selection-candidate[aria-pressed=true]').length") == 2
    page.wait("document.querySelector('.selection-limit-toast')?.textContent.includes('maximum of 2')")
    page.evaluate("document.querySelector('.selection-candidate[aria-pressed=true]').click()")
    assert page.evaluate("document.querySelectorAll('.selection-candidate[aria-pressed=true]').length") == 1

    page.click_text("button", "Confirm")
    session = page.evaluate("JSON.parse(Object.values(localStorage).find(v=>{try{return JSON.parse(v).studyType==='selection'}catch{return false}}))")
    assert len(session["selectionTrials"]) == 55, f"Expected 55 production trials, found {len(session['selectionTrials'])}"
    assert all(len(trial["candidates"]) == 6 for trial in session["selectionTrials"])
    assert [
        index + 1 for index, trial in enumerate(session["selectionTrials"])
        if trial.get("isSentinel")
    ] == [2, 4, 8, 12, 15]
    assert {trial.get("assignmentSet") for trial in session["selectionTrials"]} == {"set_01"}
    fixed_groups = json.loads(wait_http(f"{base_url}fixed_trial_groups.json"))
    expected = set(next(group["trial_ids"] for group in fixed_groups["tests"]["test4"]["groups"] if group["set_id"] == "set_01"))
    observed = {trial["trial_id"] for trial in session["selectionTrials"] if not trial.get("isSentinel")}
    assert observed == expected, "Production Test 4 did not use the hardcoded set_01 membership"

    # In-house always starts at Test 1 even if the participant entered through
    # another direct-test route.
    page.navigate(f"{base_url}inhouse/")
    page.wait("document.querySelector('h1')?.textContent.includes('In-house access')")
    page.evaluate("(() => { const field=document.querySelector('.participant-login-form input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(field,'gilab-inhouse'); field.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('form').requestSubmit(); })()")
    page.wait("document.querySelector('h1')?.textContent.includes('Visual Perception Study')")
    assert page.evaluate("document.body.innerText.includes('4 tasks') && document.body.innerText.includes('Completed one after another')"), "In-house welcome does not describe the four-test sequence"
    assert page.evaluate("(() => { const body=window.__loginBodies[window.__loginBodies.length-1]; return body.studyType === 'pairJudgment' && Boolean(body.inhouseRunId); })()"), "In-house login did not start Test 1 with a linked run ID"
    page.evaluate("document.querySelector('[role=checkbox]').click()")
    page.click_text("button", "Continue")
    page.wait("document.querySelector('h1')?.textContent.includes('Participant information')")
    for label in ["Name", "Email address", "Age", "Native language", "Country of origin"]:
        assert page.evaluate(f"[...document.querySelectorAll('.demographic-text-field > span')].some(n=>n.textContent==={json.dumps(label)})"), f"Missing in-house demographic field: {label}"
    assert page.evaluate("[...document.querySelectorAll('.demographic-field legend')].some(n=>n.textContent.includes('Task language proficiency in English'))"), "Missing in-house English proficiency field"

    open_testing_chooser(page, base_url, 8)
    page.evaluate("document.querySelectorAll('.test-choice-card')[1].click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
    page.click_text("button", "Start test")
    page.wait("document.querySelectorAll('.forced-choice-card').length === 2")
    assert_trial_fits(page, "Test 2")
    assert page.evaluate("(() => { const r=document.querySelector('.reference-sample').getBoundingClientRect(); const o=[...document.querySelectorAll('.forced-choice-card')].map(el=>el.getBoundingClientRect()); return o[0].right <= r.left && r.right <= o[1].left && Math.abs(r.width-o[0].width)<1 && Math.abs(r.width-o[1].width)<1; })()"), "Reference must be centered between equally sized A/B alternatives"
    page.evaluate("""(() => { const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src'); window.__delayStudyImages=true; Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,get:descriptor.get,set(value){if(window.__delayStudyImages)setTimeout(()=>descriptor.set.call(this,value),400);else descriptor.set.call(this,value);}}); })()""")
    page.evaluate("document.querySelector('.forced-choice-card').click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Next trial')&&!b.disabled)")
    page.click_text("button", "Next trial")
    page.wait("document.querySelector('[aria-busy=true] h1')?.textContent.includes('Preparing the next trial')")
    assert page.evaluate("document.querySelector('.trial-header-actions') === null"), "The old trial remained visible while the next images were loading"
    page.evaluate("window.__delayStudyImages=false")
    page.wait("document.querySelectorAll('.forced-choice-card').length === 2 && !document.querySelector('[aria-busy=true]')")
    session = page.evaluate("JSON.parse(Object.values(localStorage).find(v=>{try{return JSON.parse(v).studyType==='forcedChoice'}catch{return false}}))")
    assert not any(trial.get("isSentinel") for trial in session["forcedChoiceTrials"]), "Sentinels leaked into /testing Test 2"
    assert {trial.get("assignmentSet") for trial in session["forcedChoiceTrials"]} == {"set_01"}
    test2_set_01 = set(next(group["trial_ids"] for group in fixed_groups["tests"]["test2"]["groups"] if group["set_id"] == "set_01"))
    assert {trial["trial_id"] for trial in session["forcedChoiceTrials"]} <= test2_set_01, "/testing Test 2 escaped set_01"
    assert Counter(trial["difficulty_level"] for trial in session["forcedChoiceTrials"]) == Counter({
        level: 2 for level in ("easy", "medium_easy", "medium_hard", "hard")
    })

    open_testing_chooser(page, base_url, 40)
    page.evaluate("document.querySelectorAll('.test-choice-card')[0].click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
    page.click_text("button", "Start test")
    page.wait("Boolean(document.querySelector('.pair-training-shell'))")
    page.evaluate("document.querySelectorAll('.pair-training-shell [role=radiogroup]').forEach((g,i)=>{const positions=[2,0,0];[...g.querySelectorAll('[role=radio]')][positions[i]].click();})")
    page.click_text("button", "Check answers")
    page.wait("document.querySelector('[role=alert]')?.textContent.length > 0")
    assert not page.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Next example'))"), "Incorrect pair training attempt allowed progress"
    page.evaluate("document.querySelector('.attribute-help-button').click()")
    for example_index, (identity, gloss, metal) in enumerate([("1", "b", "b"), ("1", "a", "b"), ("5", "same", "same")]):
        page.wait(f"document.querySelector('.trial-header-actions')?.textContent.includes('Example {example_index + 1} of 3')")
        # Training options preserve the same identity/attribute ordering as the study.
        page.evaluate(f"document.querySelectorAll('.pair-training-shell [role=radiogroup]').forEach((g,i)=>{{const values={json.dumps([identity, gloss, metal])};const radios=[...g.querySelectorAll('[role=radio]')];const position=i===0?['1','3','5'].indexOf(values[i]):['a','same','b'].indexOf(values[i]);radios[position].click();}})")
        page.click_text("button", "Check answers")
        page.wait("document.querySelector('[role=status]')?.textContent.includes('Correct!')")
        page.click_text("button", "Begin test" if example_index == 2 else "Next example")
    page.wait("!document.querySelector('.pair-training-shell') && Boolean(document.querySelector('.pair-response-panel'))")
    assert_trial_fits(page, "Test 1")
    page.wait("document.querySelectorAll('.compact-identity-scale .scale-choice').length === 3")
    page.wait("document.querySelectorAll('.pair-attributes .pair-question').length === 2")
    assert page.evaluate("document.querySelector('.pair-attributes legend')?.textContent.includes('more glossy')")
    page.evaluate("document.querySelectorAll('.pair-attributes .pair-question').forEach(q=>q.querySelector('[role=radio]').click())")
    page.click_text("label", "Probably same")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Next trial')&&!b.disabled)")
    page.click_text("label", "Unsure")
    assert page.evaluate("document.querySelectorAll('.pair-attributes input:checked').length") == 2
    page.click_text("button", "Next trial")
    session = page.evaluate("JSON.parse(Object.values(localStorage).find(v=>{try{return JSON.parse(v).studyType==='pairJudgment'}catch{return false}}))")
    assert not any(trial.get("isSentinel") for trial in session["pairTrials"]), "Sentinels leaked into /testing Test 1"
    assert {trial.get("assignmentSet") for trial in session["pairTrials"]} == {"set_01"}
    test1_set_01 = set(next(group["trial_ids"] for group in fixed_groups["tests"]["test1"]["groups"] if group["set_id"] == "set_01"))
    assert {trial["pairId"] for trial in session["pairTrials"]} <= test1_set_01, "/testing Test 1 escaped set_01"
    assert Counter(trial["stratum"] for trial in session["pairTrials"]) == Counter({
        **{f"same_material:{level}": 5 for level in ("easy", "medium_easy", "medium_hard", "hard")},
        **{f"different_material:{level}": 5 for level in ("easy", "medium_easy", "medium_hard", "hard")},
    })
    assert session["pairTrials"][0]["glossChoice"] == "a"
    assert session["pairTrials"][0]["metalChoice"] == "a"
    attempts = session["pairTrainingAttempts"]
    assert len(attempts) == 4 and [attempt["correct"] for attempt in attempts] == [False, True, True, True]
    assert [attempt["attemptNumber"] for attempt in attempts[:2]] == [1, 2]
    assert attempts[1]["helpOpenCount"] == 1
    assert all(isinstance(attempt["responseTimeMs"], int) and attempt["responseTimeMs"] >= 0 and attempt["checkedAt"] for attempt in attempts)

    open_testing_chooser(page, base_url, 1)
    page.evaluate("document.querySelectorAll('.test-choice-card')[2].click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
    page.click_text("button", "Start test")
    page.wait("document.querySelector('.training-badge')?.textContent === 'Training' && document.querySelectorAll('.composite-scene-label:not(:disabled)').length === 3")
    assert page.evaluate("document.querySelector('h1')?.textContent.includes('in Scene 2')")
    for example_index, correct_index in enumerate((2, 2, 1, 0)):
        page.wait(f"document.querySelector('.trial-header-actions')?.textContent.includes('Example {example_index + 1} of 4')")
        page.evaluate(f"document.querySelectorAll('.composite-scene-label:not(:disabled)')[{correct_index}].click()")
        page.click_text("button", "Check answer")
        page.wait("document.querySelector('.training-feedback')?.textContent.includes('Correct!')")
        page.click_text("button", "Begin test" if example_index == 3 else "Next example")
    page.wait("document.querySelectorAll('.scene-strip').length === 2 && document.querySelectorAll('.composite-scene-label:not(:disabled)').length === 3 && !document.querySelector('.training-badge')")
    assert_trial_fits(page, "Test 3")
    assert page.evaluate("document.querySelector('.trial-header-actions')?.textContent.includes('Trial 1 of 1')")
    page.evaluate("document.querySelector('.composite-scene-label:not(:disabled)').click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Finish test')&&!b.disabled)")
    page.click_text("button", "Finish test")
    page.wait("document.querySelector('h1')?.textContent.includes('Thank you for taking part')")
    assert not page.evaluate("document.body.innerText.includes('Download a local copy')"), "Completion screen exposed the removed local-download action"
    assert not page.evaluate("document.body.innerText.includes('Confirmation receipt')"), "Completion screen exposed the internal submission receipt"
    session = page.evaluate("JSON.parse(Object.values(localStorage).find(v=>{try{return JSON.parse(v).studyType==='sceneMatching'}catch{return false}}))")
    assert not any(trial.get("isSentinel") for trial in session["sceneMatchingTrials"]), "Sentinels leaked into /testing Test 3"
    assert {trial.get("assignmentSet") for trial in session["sceneMatchingTrials"]} == {"set_01"}
    test3_set_01 = set(next(group["trial_ids"] for group in fixed_groups["tests"]["test3"]["groups"] if group["set_id"] == "set_01"))
    assert {trial["trial_id"] for trial in session["sceneMatchingTrials"]} <= test3_set_01, "/testing Test 3 escaped set_01"

    page.evaluate("localStorage.clear()")
    open_testing_chooser(page, base_url, 4)
    page.evaluate("document.querySelectorAll('.test-choice-card')[3].click()")
    page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
    page.click_text("button", "Start test")
    page.wait("document.querySelectorAll('.selection-candidate').length === 6")
    page.evaluate("document.querySelector('.selection-candidate').click()")
    page.click_text("button", "Confirm")
    session = page.evaluate("JSON.parse(Object.values(localStorage).find(v=>{try{return JSON.parse(v).studyType==='selection'}catch{return false}}))")
    assert len(session["selectionTrials"]) == 4
    assert not any(trial.get("isSentinel") for trial in session["selectionTrials"]), "Sentinels leaked into /testing Test 4"
    exceptions = [event for event in page.events if event.get("method") == "Runtime.exceptionThrown"]
    assert not exceptions, f"Unexpected browser runtime exceptions: {exceptions[-3:]}"


def main() -> None:
    if not (PROJECT / "dist/index.html").is_file():
        raise SystemExit("Build the study before running E2E tests: npm run build")
    server_port, debug_port = free_ports(2)
    with tempfile.TemporaryDirectory(prefix="material-study-chrome-") as profile:
        server = subprocess.Popen(
            ["python3", "server.py", "--host", "127.0.0.1", "--port", str(server_port)],
            cwd=PROJECT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        chrome = subprocess.Popen(
            [
                "google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu",
                "--disable-dev-shm-usage", "--remote-allow-origins=*",
                f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        page = None
        try:
            wait_http(f"http://127.0.0.1:{server_port}/")
            pair_manifest = json.loads(wait_http(f"http://127.0.0.1:{server_port}/study_pairs.json"))
            first_object = pair_manifest[0]["image_path_a"]
            assert first_object.startswith("datasetv9/renders/"), "The datasetv9 stimulus manifest is not active"
            # A developer checkout has the external dataset beside this repo;
            # the clean GitHub runner intentionally does not. Manifest and UI
            # validation still run in CI, while the full local asset test above
            # verifies every physical render before release.
            if not os.environ.get("CI"):
                wait_http(f"http://127.0.0.1:{server_port}/{first_object}")
            wait_http(f"http://127.0.0.1:{debug_port}/json/version")
            request = Request(f"http://127.0.0.1:{debug_port}/json/new", method="PUT")
            with urlopen(request, timeout=5) as response:
                target = json.load(response)
            page = ChromePage(target["webSocketDebuggerUrl"])
            page.call("Runtime.enable")
            page.call("Page.enable")
            page.call("Emulation.setDeviceMetricsOverride", {
                "width": 1366, "height": 768, "deviceScaleFactor": 1, "mobile": False,
            })
            page.call("Page.addScriptToEvaluateOnNewDocument", {
                "source": """
                  delete Array.prototype.at;
                  try { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); } catch (_) {}
                  window.__loginBodies = [];
                  window.__demographicsBodies = [];
                  window.scrollTo = () => window;
                  const nativeFetch = window.fetch.bind(window);
                  window.fetch = (input, init) => {
                    const url = typeof input === 'string' ? input : input.url;
                    if (url.endsWith('/api/v1/login')) {
                      const body = JSON.parse(init.body);
                      window.__loginBodies.push(body);
                      const inhouse = body.username === 'gilab-inhouse';
                      const assignmentBatch = inhouse ? 'set_08' : 'set_01';
                      return Promise.resolve(new Response(JSON.stringify({ token: 'e2e-token', sessionId: body.clientSessionId, studyType: body.studyType, assignmentSeed: `batch:${assignmentBatch}:${body.studyType}:e2e-user`, assignmentBatch, inhouse, alreadyCompleted: false, receiptId: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                    }
                    if (url.endsWith('/api/v1/demographics')) {
                      const body = JSON.parse(init.body);
                      window.__demographicsBodies.push(body);
                      return Promise.resolve(new Response(JSON.stringify({ savedAt: new Date().toISOString(), alreadyStored: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                    }
                    if (url.endsWith('/api/v1/submit')) return Promise.resolve(new Response(JSON.stringify({ receiptId: 'e2e-receipt', alreadyStored: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
                    return nativeFetch(input, init);
                  };
                """,
            })
            run_checks(page, f"http://127.0.0.1:{server_port}/")
            print("E2E checks passed: all four task UIs, Prolific/in-house demographic separation, pair-training logs, scene training, production gate, selection cap, and deselection.")
        finally:
            if page is not None:
                page.close()
            chrome.terminate()
            server.terminate()
            chrome.wait(timeout=5)
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
