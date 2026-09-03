/**
 * Runs the API and the storefront as one container.
 *
 * WHY A SUPERVISOR AND NOT `node a & node b`
 * A shell backgrounding two processes gets three things wrong, and all three
 * only show up when something has already gone wrong:
 *
 *   - PID 1 is the shell, so SIGTERM from `docker stop` reaches it and not the
 *     Node processes. They are killed by the 10-second SIGKILL instead of
 *     shutting down, every single time.
 *   - If one process dies the other keeps running, and the container stays "up"
 *     while serving errors. A half-alive container that still answers its
 *     healthcheck is worse than a dead one, because nothing restarts it.
 *   - The exit code is the shell's, so a crash looks like a clean stop.
 *
 * Written in Node rather than bash because Node is the one interpreter this
 * image is guaranteed to have, and signal forwarding here is explicit rather
 * than dependent on `wait -n` and the shell's job control.
 *
 * WHAT THIS IS FOR
 * Running the whole application from one image, for a demo or a machine where
 * orchestrating several containers is not worth it. It is deliberately NOT the
 * deployment shape: the two tiers cannot be scaled independently here, which is
 * the property docker-compose.yml and the Kubernetes manifests exist to keep.
 *
 * See docs/adr/0023-all-in-one-image.md
 */

import { spawn } from "node:child_process";

const API_PORT = process.env.API_PORT ?? "4000";
const WEB_PORT = process.env.PORT ?? "3000";

/** Started, in order. The API first so the storefront has something to proxy to. */
const services = [
  {
    name: "api",
    cwd: "/app/api",
    args: ["dist/index.js"],
    env: {
      PORT: API_PORT,
      // Uploads on the disk driver are served by the API itself, so the URL it
      // writes into rows has to be one a browser can resolve. Inside one
      // container that is this container's own published port.
      PUBLIC_UPLOAD_BASE:
        process.env.PUBLIC_UPLOAD_BASE ?? `http://localhost:${API_PORT}/uploads`,
    },
  },
  {
    name: "web",
    cwd: "/app/web",
    args: ["server.js"],
    env: {
      PORT: WEB_PORT,
      // Standalone binds to HOSTNAME and defaults to localhost, which inside a
      // container accepts nothing from outside it. Forgetting this produces a
      // container that looks healthy and refuses every connection.
      HOSTNAME: "0.0.0.0",
      // Loopback, not a service name: the API is in this container. This is the
      // one line that makes the all-in-one image work without a network.
      BACKEND_URL: `http://127.0.0.1:${API_PORT}`,
    },
  },
];

const children = new Map();
let shuttingDown = false;

/** Prefixes each line so two processes sharing stdout stay readable. */
function pipe(name, stream, sink) {
  let partial = "";
  stream.on("data", (chunk) => {
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) sink.write(`[${name}] ${line}\n`);
  });
}

for (const service of services) {
  const child = spawn(process.execPath, service.args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  pipe(service.name, child.stdout, process.stdout);
  pipe(service.name, child.stderr, process.stderr);
  children.set(service.name, child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    /**
     * EITHER ONE DYING TAKES THE CONTAINER WITH IT.
     *
     * The alternative is a container that is up, passes a healthcheck on
     * whichever process survived, and serves 502s from the other. Exiting
     * lets the restart policy — or Kubernetes — do its job.
     */
    console.error(
      `[supervisor] ${service.name} exited (${signal ?? `code ${code}`}) — stopping the container`
    );
    shutdown(signal ? "SIGTERM" : "SIGTERM", code ?? 1);
  });
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const [name, child] of children) {
    if (child.exitCode === null && child.signalCode === null) {
      console.error(`[supervisor] stopping ${name}`);
      child.kill(signal);
    }
  }

  /**
   * A deadline, so a process that ignores SIGTERM cannot hold the container
   * open until Docker's own SIGKILL. Five seconds is longer than either needs
   * to close its listeners.
   */
  const deadline = setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(exitCode);
  }, 5000);
  deadline.unref();

  const done = setInterval(() => {
    const alive = [...children.values()].some(
      (c) => c.exitCode === null && c.signalCode === null
    );
    if (!alive) {
      clearInterval(done);
      process.exit(exitCode);
    }
  }, 100);
  done.unref();
}

// Forwarded rather than inherited: this process is PID 1, so nothing else will
// deliver these to the children.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.error(`[supervisor] ${signal} received`);
    shutdown(signal, 0);
  });
}
