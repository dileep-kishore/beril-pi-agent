"""beril lit — search/fetch literature records and emit JSON (per the subcommand I/O contract).

``search`` emits a JSON array of normalized records; ``fetch`` emits a single JSON object.
"""

from __future__ import annotations

import argparse
import json
import sys

import httpx

from beril_cli.lit_client import fetch_article, search_pubmed


def run_lit(args: argparse.Namespace) -> int:
    if args.action == "search":
        if not args.query:
            print("search requires --query.", file=sys.stderr)
            return 2
        try:
            records = search_pubmed(args.query, retmax=args.max)
        except (httpx.HTTPError, ValueError) as exc:
            print(f"literature search failed: {exc}", file=sys.stderr)
            return 1
        json.dump(records, sys.stdout, default=str)
        sys.stdout.write("\n")
        return 0

    if args.action == "fetch":
        if not args.pmid:
            print("fetch requires --pmid.", file=sys.stderr)
            return 2
        try:
            record = fetch_article(args.pmid)
        except (httpx.HTTPError, ValueError) as exc:
            print(f"literature fetch failed: {exc}", file=sys.stderr)
            return 1
        json.dump(record, sys.stdout, default=str)
        sys.stdout.write("\n")
        return 0

    print(f"unknown lit action: {args.action}", file=sys.stderr)
    return 2
