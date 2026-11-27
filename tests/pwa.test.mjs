import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const load = name => readFile(new URL(`../public/${name}`, import.meta.url));
test("the two installed roles have distinct launch scopes and correctly sized CleanMa icons", async () => {
  const roles = await Promise.all(["owner", "cleaner"].map(async role => JSON.parse(await load(`manifest-${role}.webmanifest`))));
  assert.deepEqual(roles.map(x => x.start_url), ["/admin", "/cleaner.html"]);
  assert.notEqual(roles[0].id, roles[1].id);
  for (const [index, role] of roles.entries()) {
    assert.equal(role.display, "standalone");
    assert(role.start_url.startsWith(role.scope));
    assert(!roles[1 - index].start_url.startsWith(role.scope));
    for (const icon of role.icons) {
      const image = await load(icon.src.slice(1));
      assert.equal(`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`, icon.sizes);
    }
  }
  const touch = await load("pwa/apple-touch-icon.png");
  assert.equal(touch.readUInt32BE(16), 180);
  assert.equal(touch.readUInt32BE(20), 180);
  const cleaner = await load("cleaner.html");
  assert.match(cleaner.toString().split("</head>")[0], /rel="manifest" href="\/manifest-cleaner.webmanifest"/);
});

test("the worker ignores navigations, API, server functions, auth and foreign URLs and only caches validated public files", async () => {
  const listeners = {};
  const saved = [];
  const origin = "https://cleanmaapp.com";
  let upstream = new Response("test", { headers: { "Content-Type": "text/javascript" } });
  runInNewContext((await load("sw.js")).toString(), {
    self: { location: { origin }, addEventListener: (name, fn) => { listeners[name] = fn; } },
    caches: { open: async () => ({ match: async () => undefined, put: async req => saved.push(req.url) }) },
    fetch: async () => upstream, URL,
  });
  function dispatch(path, init = {}) {
    let response;
    listeners.fetch({
      request: { url: new URL(path, origin).href, method: "GET", mode: "same-origin", headers: new Headers(), ...init },
      respondWith: value => { response = value; },
    });
    return response;
  }
  for (const path of ["/admin", "/cleaner.html", "/api/payments", "/_serverFn/123", "/auth", "/planos", "https://other.example/assets/a-ABCDEF12.js"]) {
    assert.equal(dispatch(path), undefined, path);
  }
  const asset = "/assets/app-ABCDEF12.js";
  assert.equal(dispatch(asset, { mode: "navigate" }), undefined);
  assert.equal(dispatch(asset, { headers: new Headers({ Authorization: "Bearer test" }) }), undefined);
  assert.equal(await dispatch(asset), upstream);
  assert.deepEqual(saved, [origin + asset]);
  upstream = new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
  assert.equal(await dispatch(asset), upstream);
  assert.deepEqual(saved, [origin + asset]);
});
