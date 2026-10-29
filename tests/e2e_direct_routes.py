#!/usr/bin/env python3
"""Smoke-test direct task routes, compatibility fallback, and bounded preloading."""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from e2e_study import ChromePage, PROJECT, free_ports, wait_http


ROUTES = ("test1_pair_comparison", "test2_2afc", "test3_matching", "test3.2_matching2", "test4_mm")


def main() -> None:
    server_port, debug_port = free_ports(2)
    with tempfile.TemporaryDirectory(prefix="material-study-routes-") as profile:
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
            base = f"http://127.0.0.1:{server_port}"
            wait_http(base + "/")
            wait_http(f"http://127.0.0.1:{debug_port}/json/version")
            request = Request(f"http://127.0.0.1:{debug_port}/json/new", method="PUT")
            with urlopen(request, timeout=5) as response:
                target = json.load(response)
            page = ChromePage(target["webSocketDebuggerUrl"])
            page.call("Runtime.enable")
            page.call("Page.enable")
            page.call("Page.addScriptToEvaluateOnNewDocument", {
                "source": """
                    delete Array.prototype.at;
                    try { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); } catch (_) {}
                    let localStudyConfig = {};
                    Object.defineProperty(window, 'USER_STUDY_CONFIG', {
                      configurable: true,
                      get: () => localStudyConfig,
                      set: (value) => { localStudyConfig = { ...value, stimulusBaseUrl: '', apiBaseUrl: '' }; },
                    });
                    const originalFetch = globalThis.fetch.bind(globalThis);
                    globalThis.fetch = async (input, init) => {
                      if (String(input).endsWith('/health')) {
                        return new Response(JSON.stringify({
                          ok: true,
                          service: 'perception-study-api',
                          database: 'connected',
                          sentinelScreeningVersion: '2026-10-23.1',
                          studyTypes: ['pairJudgment', 'forcedChoice', 'sceneMatching', 'contextMatching2', 'selection'],
                        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                      }
                      if (String(input).includes('/api/v1/anonymous-login')) {
                        const request = JSON.parse(String(init?.body || '{}'));
                        return new Response(JSON.stringify({
                          ok: true,
                          token: 'anonymous-route-test-token',
                          sessionId: `anonymous-${request.studyType}`,
                          studyType: request.studyType,
                          assignmentSeed: `batch:set_01:anon:${request.studyType}`,
                          assignmentBatch: 'set_01',
                          inhouse: false,
                          anonymousEntry: true,
                          alreadyCompleted: false,
                          screenedOut: false,
                          sentinelScreeningVersion: '2026-10-23.1',
                        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                      }
                      return originalFetch(input, init);
                    };
                """,
            })

            for route in ROUTES:
                for suffix in (route, route + "/"):
                    page.events.clear()
                    query = "PROLIFIC_PID=route-smoke&STUDY_ID=route-study&SESSION_ID=route-session"
                    page.navigate(f"{base}/{suffix}?{query}")
                    page.wait("document.querySelector('h1')?.textContent.includes('Participant access')")
                    assert page.evaluate("document.querySelectorAll('.participant-login-form input').length === 1")
                    exceptions = [event for event in page.events if event.get("method") == "Runtime.exceptionThrown"]
                    assert not exceptions, f"Runtime exception on /{suffix}: {exceptions[-1]}"

            for route in ROUTES:
                for suffix in (f"anon/{route}", f"anon/{route}/"):
                    page.events.clear()
                    query = f"PROLIFIC_PID=anon-{route}&STUDY_ID=anon-study-{route}&SESSION_ID=anon-session-{route}"
                    page.navigate(f"{base}/{suffix}?{query}")
                    page.wait("document.querySelector('h1')?.textContent.includes('Visual Perception Study')")
                    assert page.evaluate("document.querySelectorAll('.participant-login-form input').length === 0")
                    exceptions = [event for event in page.events if event.get("method") == "Runtime.exceptionThrown"]
                    assert not exceptions, f"Runtime exception on /{suffix}: {exceptions[-1]}"

            page.navigate(f"{base}/testing/?trials=8")
            page.wait("document.querySelectorAll('.test-choice-card').length === 5")
            page.evaluate("document.querySelectorAll('.test-choice-card')[3].click()")
            page.wait("[...document.querySelectorAll('button')].some(button => button.textContent.includes('Start test') && !button.disabled)", timeout=30)
            page.evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Start test')).click()")
            page.wait("document.querySelectorAll('.composite-scene-label:not(:disabled)').length === 2")
            assert page.evaluate("document.body.innerText.includes('1 or 2')")

            traversal = Request(base + "/%2e%2e/server.py")
            try:
                urlopen(traversal, timeout=5)
            except HTTPError as error:
                assert error.code == 404
            else:
                raise AssertionError("The study server exposed a file outside dist")

            print("Direct-route E2E passed: credential and anonymous Prolific routes with/without trailing slash, approved testing route, legacy browser fallback, and path containment.")
        finally:
            if page is not None:
                page.close()
            chrome.terminate()
            server.terminate()
            chrome.wait(timeout=5)
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
