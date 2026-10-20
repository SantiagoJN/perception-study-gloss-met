#!/usr/bin/env python3
"""Read-only desktop viewer for Cloudflare D1 SQL exports.

The dump is restored into an in-memory SQLite database. The source SQL file and
the remote D1 database are never modified.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any


DEFAULT_BACKUP_DIRECTORIES = (
    Path(r"V:\vlm_dataset\perception-study-gloss-met\cloudflare-worker\backups"),
    Path(r"Y:\VLM-user-study-results\prolific"),
)


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def latest_backup() -> Path | None:
    candidates: dict[Path, Path] = {}
    for directory in DEFAULT_BACKUP_DIRECTORIES:
        if not directory.is_dir():
            continue
        for candidate in directory.glob("*.sql"):
            try:
                candidates[candidate.resolve()] = candidate
            except OSError:
                continue
    return max(candidates.values(), key=lambda item: item.stat().st_mtime, default=None)


def load_export(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise FileNotFoundError(f"SQL export not found: {path}")
    sql = path.read_text(encoding="utf-8-sig")
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.executescript(sql)
    except Exception:
        connection.close()
        raise
    return connection


def table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        """
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name COLLATE NOCASE
        """
    ).fetchall()
    return [str(row[0]) for row in rows]


def table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(
        f"PRAGMA table_xinfo({quote_identifier(table)})"
    ).fetchall()
    return [str(row[1]) for row in rows if int(row[6]) == 0]


def table_count(connection: sqlite3.Connection, table: str) -> int:
    row = connection.execute(
        f"SELECT COUNT(*) FROM {quote_identifier(table)}"
    ).fetchone()
    return int(row[0])


def print_summary(path: Path, connection: sqlite3.Connection) -> None:
    print(f"Export: {path}")
    print(f"Size: {path.stat().st_size:,} bytes")
    print("Tables:")
    for table in table_names(connection):
        print(f"  {table}: {table_count(connection, table):,} rows")


def format_value(value: Any, maximum: int = 500) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        text = f"<BLOB: {len(value)} bytes>"
    else:
        text = str(value).replace("\r\n", " ").replace("\n", " ")
    return text if len(text) <= maximum else text[: maximum - 1] + "…"


def pretty_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return f"<BLOB: {len(value)} bytes>\n\n{value.hex()}"
    text = str(value)
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text
    return json.dumps(parsed, ensure_ascii=False, indent=2)


class ExportViewer:
    def __init__(self, root: Any, initial_path: Path | None, page_size: int) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        self.root = root
        self.connection: sqlite3.Connection | None = None
        self.path: Path | None = None
        self.current_table: str | None = None
        self.columns: list[str] = []
        self.loaded_rows: dict[str, sqlite3.Row] = {}
        self.page = 0
        self.total_rows = 0

        root.title("D1 study results viewer")
        root.geometry("1380x820")
        root.minsize(900, 600)

        self.path_text = tk.StringVar(value="No export loaded")
        self.status_text = tk.StringVar(value="Read-only viewer")
        self.filter_text = tk.StringVar()
        self.page_size_text = tk.StringVar(value=str(page_size))
        self.page_text = tk.StringVar(value="")

        self._build_interface()
        if initial_path is not None:
            self.open_export(initial_path)
        else:
            root.after(100, self.choose_export)

    def _build_interface(self) -> None:
        from tkinter import ttk

        header = ttk.Frame(self.root, padding=(12, 10))
        header.pack(fill="x")
        ttk.Label(header, text="D1 study results", font=("Segoe UI", 16, "bold")).pack(side="left")
        ttk.Button(header, text="Open SQL export…", command=self.choose_export).pack(side="right")
        ttk.Label(header, textvariable=self.path_text).pack(side="left", padx=(18, 0))

        panes = ttk.Panedwindow(self.root, orient="horizontal")
        panes.pack(fill="both", expand=True, padx=12, pady=(0, 8))

        sidebar = ttk.Frame(panes, padding=8)
        main = ttk.Frame(panes, padding=8)
        panes.add(sidebar, weight=1)
        panes.add(main, weight=5)

        ttk.Label(sidebar, text="Tables", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(0, 6))
        self.table_list = ttk.Treeview(sidebar, columns=("rows",), show="tree headings", selectmode="browse")
        self.table_list.heading("#0", text="Table")
        self.table_list.heading("rows", text="Rows")
        self.table_list.column("#0", width=190, stretch=True)
        self.table_list.column("rows", width=70, anchor="e", stretch=False)
        self.table_list.pack(fill="both", expand=True)
        self.table_list.bind("<<TreeviewSelect>>", self.on_table_selected)

        controls = ttk.Frame(main)
        controls.pack(fill="x", pady=(0, 8))
        ttk.Label(controls, text="Filter:").pack(side="left")
        filter_entry = ttk.Entry(controls, textvariable=self.filter_text, width=34)
        filter_entry.pack(side="left", padx=(6, 5))
        filter_entry.bind("<Return>", lambda _event: self.apply_filter())
        ttk.Button(controls, text="Apply", command=self.apply_filter).pack(side="left")
        ttk.Button(controls, text="Clear", command=self.clear_filter).pack(side="left", padx=(4, 14))
        ttk.Label(controls, text="Rows per page:").pack(side="left")
        page_size = ttk.Combobox(
            controls,
            textvariable=self.page_size_text,
            values=("25", "50", "100", "250", "500"),
            state="readonly",
            width=6,
        )
        page_size.pack(side="left", padx=(6, 0))
        page_size.bind("<<ComboboxSelected>>", lambda _event: self.apply_filter())
        ttk.Button(controls, text="Previous", command=self.previous_page).pack(side="right")
        ttk.Label(controls, textvariable=self.page_text).pack(side="right", padx=10)
        ttk.Button(controls, text="Next", command=self.next_page).pack(side="right")

        notebook = ttk.Notebook(main)
        notebook.pack(fill="both", expand=True)
        data_tab = ttk.Frame(notebook)
        schema_tab = ttk.Frame(notebook)
        notebook.add(data_tab, text="Contents")
        notebook.add(schema_tab, text="Schema")

        data_pane = ttk.Panedwindow(data_tab, orient="vertical")
        data_pane.pack(fill="both", expand=True)
        grid_frame = ttk.Frame(data_pane)
        detail_frame = ttk.Frame(data_pane, padding=(0, 8, 0, 0))
        data_pane.add(grid_frame, weight=4)
        data_pane.add(detail_frame, weight=1)

        self.data_grid = ttk.Treeview(grid_frame, show="headings", selectmode="browse")
        vertical = ttk.Scrollbar(grid_frame, orient="vertical", command=self.data_grid.yview)
        horizontal = ttk.Scrollbar(grid_frame, orient="horizontal", command=self.data_grid.xview)
        self.data_grid.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
        self.data_grid.grid(row=0, column=0, sticky="nsew")
        vertical.grid(row=0, column=1, sticky="ns")
        horizontal.grid(row=1, column=0, sticky="ew")
        grid_frame.rowconfigure(0, weight=1)
        grid_frame.columnconfigure(0, weight=1)
        self.data_grid.bind("<<TreeviewSelect>>", self.show_selected_row)

        ttk.Label(detail_frame, text="Selected row", font=("Segoe UI", 10, "bold")).pack(anchor="w")
        detail_container = ttk.Frame(detail_frame)
        detail_container.pack(fill="both", expand=True, pady=(4, 0))
        self.detail_text = self.tk.Text(detail_container, height=9, wrap="none", state="disabled")
        detail_scroll_y = ttk.Scrollbar(detail_container, orient="vertical", command=self.detail_text.yview)
        detail_scroll_x = ttk.Scrollbar(detail_container, orient="horizontal", command=self.detail_text.xview)
        self.detail_text.configure(yscrollcommand=detail_scroll_y.set, xscrollcommand=detail_scroll_x.set)
        self.detail_text.grid(row=0, column=0, sticky="nsew")
        detail_scroll_y.grid(row=0, column=1, sticky="ns")
        detail_scroll_x.grid(row=1, column=0, sticky="ew")
        detail_container.rowconfigure(0, weight=1)
        detail_container.columnconfigure(0, weight=1)

        self.schema_text = self.tk.Text(schema_tab, wrap="none", state="disabled")
        schema_y = ttk.Scrollbar(schema_tab, orient="vertical", command=self.schema_text.yview)
        schema_x = ttk.Scrollbar(schema_tab, orient="horizontal", command=self.schema_text.xview)
        self.schema_text.configure(yscrollcommand=schema_y.set, xscrollcommand=schema_x.set)
        self.schema_text.grid(row=0, column=0, sticky="nsew")
        schema_y.grid(row=0, column=1, sticky="ns")
        schema_x.grid(row=1, column=0, sticky="ew")
        schema_tab.rowconfigure(0, weight=1)
        schema_tab.columnconfigure(0, weight=1)

        ttk.Label(self.root, textvariable=self.status_text, anchor="w", padding=(12, 4)).pack(fill="x")

    def choose_export(self) -> None:
        from tkinter import filedialog

        initial = next((str(path) for path in DEFAULT_BACKUP_DIRECTORIES if path.is_dir()), str(Path.home()))
        selected = filedialog.askopenfilename(
            title="Open D1 SQL export",
            initialdir=initial,
            filetypes=(("SQL exports", "*.sql"), ("All files", "*.*")),
        )
        if selected:
            self.open_export(Path(selected))

    def open_export(self, path: Path) -> None:
        from tkinter import messagebox

        try:
            new_connection = load_export(path)
        except Exception as error:
            messagebox.showerror("Could not open export", str(error), parent=self.root)
            return
        if self.connection is not None:
            self.connection.close()
        self.connection = new_connection
        self.path = path
        self.path_text.set(str(path))
        self.status_text.set(f"Loaded read-only copy · {path.stat().st_size:,} bytes")
        self.current_table = None
        self.table_list.delete(*self.table_list.get_children())
        for table in table_names(new_connection):
            self.table_list.insert("", "end", iid=table, text=table, values=(f"{table_count(new_connection, table):,}",))
        children = self.table_list.get_children()
        if children:
            self.table_list.selection_set(children[0])
            self.table_list.focus(children[0])
            self.show_table(str(children[0]))

    def on_table_selected(self, _event: Any) -> None:
        selection = self.table_list.selection()
        if selection:
            self.show_table(str(selection[0]))

    def show_table(self, table: str) -> None:
        if self.connection is None:
            return
        self.current_table = table
        self.columns = table_columns(self.connection, table)
        self.page = 0
        self._show_schema()
        self._load_page()

    def _filter_clause(self) -> tuple[str, list[str]]:
        query = self.filter_text.get().strip()
        if not query or not self.columns:
            return "", []
        clauses = [f"CAST({quote_identifier(column)} AS TEXT) LIKE ? COLLATE NOCASE" for column in self.columns]
        return " WHERE " + " OR ".join(clauses), [f"%{query}%"] * len(clauses)

    def _load_page(self) -> None:
        if self.connection is None or self.current_table is None:
            return
        page_size = int(self.page_size_text.get())
        where, parameters = self._filter_clause()
        table = quote_identifier(self.current_table)
        self.total_rows = int(self.connection.execute(f"SELECT COUNT(*) FROM {table}{where}", parameters).fetchone()[0])
        maximum_page = max(0, (self.total_rows - 1) // page_size)
        self.page = min(self.page, maximum_page)
        rows = self.connection.execute(
            f"SELECT * FROM {table}{where} LIMIT ? OFFSET ?",
            [*parameters, page_size, self.page * page_size],
        ).fetchall()

        self.data_grid.delete(*self.data_grid.get_children())
        self.data_grid["columns"] = self.columns
        for column in self.columns:
            self.data_grid.heading(column, text=column)
            self.data_grid.column(column, width=max(120, min(320, len(column) * 9 + 30)), stretch=True)
        self.loaded_rows.clear()
        for index, row in enumerate(rows):
            item = f"row-{index}"
            self.loaded_rows[item] = row
            self.data_grid.insert("", "end", iid=item, values=[format_value(row[column]) for column in self.columns])
        start = self.page * page_size + (1 if self.total_rows else 0)
        end = min((self.page + 1) * page_size, self.total_rows)
        self.page_text.set(f"{start:,}–{end:,} of {self.total_rows:,}")
        self.status_text.set(f"{self.current_table}: {self.total_rows:,} matching rows · read-only")
        self._set_text(self.detail_text, "Select a row to inspect complete values and formatted JSON.")

    def _show_schema(self) -> None:
        if self.connection is None or self.current_table is None:
            return
        row = self.connection.execute(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
            (self.current_table,),
        ).fetchone()
        definitions = self.connection.execute(
            f"PRAGMA table_xinfo({quote_identifier(self.current_table)})"
        ).fetchall()
        lines = [str(row[0] if row and row[0] else ""), "", "Columns:"]
        for column in definitions:
            lines.append(
                f"- {column[1]} · type={column[2] or 'ANY'} · not_null={bool(column[3])} · "
                f"default={column[4]} · primary_key={bool(column[5])}"
            )
        self._set_text(self.schema_text, "\n".join(lines))

    def show_selected_row(self, _event: Any) -> None:
        selection = self.data_grid.selection()
        if not selection:
            return
        row = self.loaded_rows.get(str(selection[0]))
        if row is None:
            return
        sections = [f"{column}:\n{pretty_value(row[column])}" for column in self.columns]
        self._set_text(self.detail_text, "\n\n".join(sections))

    @staticmethod
    def _set_text(widget: Any, value: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", value)
        widget.configure(state="disabled")

    def apply_filter(self) -> None:
        self.page = 0
        self._load_page()

    def clear_filter(self) -> None:
        self.filter_text.set("")
        self.apply_filter()

    def previous_page(self) -> None:
        if self.page > 0:
            self.page -= 1
            self._load_page()

    def next_page(self) -> None:
        page_size = int(self.page_size_text.get())
        if (self.page + 1) * page_size < self.total_rows:
            self.page += 1
            self._load_page()


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sql_file", nargs="?", type=Path, help="D1 .sql export; defaults to the newest configured backup")
    parser.add_argument("--summary", action="store_true", help="print table row counts without opening the GUI")
    parser.add_argument("--page-size", type=int, default=100, choices=(25, 50, 100, 250, 500))
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    path = arguments.sql_file or latest_backup()
    if arguments.summary:
        if path is None:
            print("No SQL export was found.", file=sys.stderr)
            return 1
        try:
            connection = load_export(path)
            print_summary(path, connection)
            connection.close()
        except Exception as error:
            print(f"Could not read export: {error}", file=sys.stderr)
            return 1
        return 0

    try:
        import tkinter as tk
    except ImportError:
        print("Tkinter is required for the graphical viewer. Use --summary for terminal output.", file=sys.stderr)
        return 1
    root = tk.Tk()
    ExportViewer(root, path, arguments.page_size)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

