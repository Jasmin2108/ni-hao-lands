"use strict";
// Read-only $nihala holder checks over public Solana JSON-RPC.
// Never builds, signs or sends a transaction: only getTokenAccountsByOwner reads.

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function createHolderChecker({ rpc, mint, minBalance = 0, cacheMs = 7 * 60 * 1000, timeoutMs = 8000, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const cache = new Map(); // owner -> status
  const inflight = new Map();

  async function rpcCall(method, params) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await doFetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error("RPC HTTP " + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "RPC error");
      return j.result;
    } finally {
      clearTimeout(t);
    }
  }

  function sumAccounts(result) {
    let ui = 0, raw = 0n, programs = new Set();
    for (const acc of (result && result.value) || []) {
      const data = acc && acc.account && acc.account.data;
      const info = data && data.parsed && data.parsed.info;
      if (!info || info.mint !== mint || !info.tokenAmount) continue;
      const ta = info.tokenAmount;
      raw += BigInt(ta.amount || "0");
      ui += Number(ta.uiAmountString != null ? ta.uiAmountString : ta.uiAmount || 0);
      if (data.program) programs.add(data.program);
      if (acc.account.owner) programs.add(acc.account.owner);
    }
    return { ui, raw, programs };
  }
  const byMint = (owner) => rpcCall("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]).then(sumAccounts);
  const byProgram = (owner, programId) => rpcCall("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]).then(sumAccounts);

  async function fetchStatus(owner) {
    // Primary: the mint filter. The RPC resolves the mint's owning program, so this covers Token and Token-2022 mints.
    // Fallback: scan both programs explicitly (heavier for big wallets).
    let total, via;
    try {
      total = await byMint(owner);
      via = "mint";
    } catch (e) {
      const results = await Promise.allSettled([byProgram(owner, TOKEN_PROGRAM), byProgram(owner, TOKEN_2022_PROGRAM)]);
      const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
      if (!ok.length) throw results[0].reason || e;
      total = { ui: 0, raw: 0n };
      for (const v of ok) { total.ui += v.ui; total.raw += v.raw; }
      // a partial scan can't prove a zero balance
      if (ok.length < results.length && total.ui <= minBalance) throw new Error("partial RPC result");
      via = "programs";
    }
    return {
      owner, mint,
      balance: total.ui,
      amount: total.raw.toString(),
      holder: total.ui > minBalance,
      checkedAt: Date.now(),
      via,
      error: null,
    };
  }

  // Returns cached status when fresh; otherwise re-reads. On RPC failure keeps the last known status.
  async function check(owner, { force = false } = {}) {
    if (!ADDRESS_RE.test(String(owner || ""))) return { owner, mint, balance: 0, amount: "0", holder: false, checkedAt: Date.now(), error: "invalid address" };
    const prev = cache.get(owner);
    if (!force && prev && Date.now() - prev.checkedAt < cacheMs) return prev;
    if (inflight.has(owner)) return inflight.get(owner);
    const p = fetchStatus(owner)
      .then((st) => { cache.set(owner, st); return st; })
      .catch((e) => {
        const msg = String((e && e.message) || e);
        if (prev) { const kept = { ...prev, checkedAt: Date.now() - cacheMs + 60000, error: msg }; cache.set(owner, kept); return kept; }
        return { owner, mint, balance: 0, amount: "0", holder: false, checkedAt: Date.now(), error: msg };
      })
      .finally(() => inflight.delete(owner));
    inflight.set(owner, p);
    return p;
  }

  return { check, peek: (owner) => cache.get(owner) || null, clear: () => cache.clear(), mint, minBalance, cacheMs };
}

module.exports = { createHolderChecker, TOKEN_PROGRAM, TOKEN_2022_PROGRAM };
