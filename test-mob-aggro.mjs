// Mob aggro rules: death -> every chasing mob drops aggro and walks home -> grace period -> safe respawn;
// general leash: mobs give up when the player runs away. Usage: node test-mob-aggro.mjs
import { startServer, client, sleep, assert } from "./test-helpers.mjs";

async function main() {
  const srv = await startServer("nhl-aggro-", Number(process.env.TEST_PORT || 3240));
  try {
    const a = client(srv.base);
    await a.open; await a.ready();
    const spawn = { x: a.me.x, y: a.me.y };
    let st = await a.mobs();
    const dog = st.mobs.find((m) => m.id === "dog-1");
    const dog3 = st.mobs.find((m) => m.id === "dog-3");
    // stand next to dog-1, make it and dog-3 hunt us, drop to 1 HP
    a.send({ type: "__test", op: "tp", x: Math.round(dog.x) + 1, y: Math.round(dog.y) });
    await sleep(150);
    a.send({ type: "__test", op: "aggro", id: "dog-1" });
    a.send({ type: "__test", op: "aggro", id: "dog-3" });
    a.send({ type: "__test", op: "hp", hp: 1 });
    st = await a.mobs();
    assert(st.mobs.find((m) => m.id === "dog-1").target === a.me.id, "dog-1 is attacking the player");
    const died = await a.wait((m) => m.type === "fx" && m.kind === "death", 10000, "death");
    assert(!!died, "player dies to the dog");
    st = await a.mobs();
    assert(st.mobs.every((m) => m.target !== a.me.id), "every mob dropped aggro immediately on death");
    const d1 = st.mobs.find((m) => m.id === "dog-1");
    assert(d1.returning || Math.hypot(d1.x - d1.homeX, d1.y - d1.homeY) < 0.1, "dog-1 is walking back to its spawn");
    assert(d1.grace > 30000 && st.graceLeft > 30000, `grace period active (${Math.round(st.graceLeft / 1000)} s)`);
    assert(Math.round(st.me.x) === spawn.x && Math.round(st.me.y) === spawn.y && st.me.hp === 20, "respawned at full HP in the village");
    const nearest = Math.min(...st.mobs.filter((m) => m.alive).map((m) => Math.hypot(m.x - st.me.x, m.y - st.me.y)));
    assert(nearest >= 10, `respawn is safe: nearest mob ${nearest.toFixed(1)} tiles away`);
    // go straight back next to the dog: it must not re-aggro during the grace period
    await sleep(2500);
    st = await a.mobs();
    const back = st.mobs.find((m) => m.id === "dog-1");
    a.send({ type: "__test", op: "tp", x: Math.round(back.x) + 1, y: Math.round(back.y) });
    a.send({ type: "__test", op: "aggro", id: "dog-1" });
    const hpBefore = a.me.hp;
    await sleep(3200);
    st = await a.mobs();
    assert(st.mobs.every((m) => m.target !== a.me.id), "no mob re-aggros during the grace period");
    assert(st.me.hp === 20 && hpBefore === 20, "no damage taken during the grace period");
    const d1b = st.mobs.find((m) => m.id === "dog-1");
    assert(Math.hypot(d1b.x - d1b.homeX, d1b.y - d1b.homeY) < 4, "dog-1 is back near home");

    // Leash: a fresh player pulls dog-2 and runs away; the dog gives up and goes home.
    const b = client(srv.base);
    await b.open; await b.ready();
    st = await b.mobs();
    const d2 = st.mobs.find((m) => m.id === "dog-2");
    b.send({ type: "__test", op: "tp", x: Math.round(d2.x) + 1, y: Math.round(d2.y) });
    await sleep(100);
    b.send({ type: "__test", op: "aggro", id: "dog-2" });
    st = await b.mobs();
    assert(st.mobs.find((m) => m.id === "dog-2").target === b.me.id, "dog-2 chases the second player");
    b.send({ type: "__test", op: "tp", x: Math.round(d2.homeX) + 14, y: Math.round(d2.homeY) });
    await sleep(600);
    st = await b.mobs();
    let d2b = st.mobs.find((m) => m.id === "dog-2");
    assert(d2b.target !== b.me.id && (d2b.returning || Math.hypot(d2b.x - d2b.homeX, d2b.y - d2b.homeY) < 0.1), "dog-2 gives up the chase when the player gets away");
    await sleep(2500);
    st = await b.mobs();
    d2b = st.mobs.find((m) => m.id === "dog-2");
    assert(!d2b.target && Math.hypot(d2b.x - d2b.homeX, d2b.y - d2b.homeY) < 4.5, "dog-2 walked back home and stays calm");
    assert(Math.hypot(d2b.x - d2b.homeX, d2b.y - d2b.homeY) <= 10, "dog-2 never strayed past its leash");
    a.ws.close(); b.ws.close();
    console.log("\nALL MOB AGGRO TESTS PASSED");
  } finally {
    await srv.stop();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
