const { app, BrowserWindow, dialog, shell } = require("electron");
const { mkdir, access } = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let embeddedServer;
let shuttingDown = false;

async function findAvailablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => probe.close(resolve));
    throw new Error("Could not select a local PMS port.");
  }
  await new Promise((resolve, reject) => {
    probe.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function startPms() {
  const applicationPath = app.getAppPath();
  const clientDirectory = path.join(applicationPath, "client", "dist");
  const serverModule = path.join(applicationPath, "server", "dist", "embedded.js");
  const dataDirectory = path.join(app.getPath("userData"), "data");
  const databasePath = path.join(dataDirectory, "pms.db");
  const port = await findAvailablePort();

  await Promise.all([
    mkdir(dataDirectory, { recursive: true }),
    access(path.join(clientDirectory, "index.html")),
    access(serverModule),
  ]);

  process.env.PMS_DATABASE_PATH = databasePath;
  process.env.PMS_CLIENT_DIST = clientDirectory;
  process.env.PMS_FRONTEND_ORIGIN = `http://127.0.0.1:${port}`;

  const { startEmbeddedServer } = await import(pathToFileURL(serverModule).href);
  embeddedServer = await startEmbeddedServer(databasePath, port);

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(startPms).catch((error) => {
  console.error("Could not start ZCSMST PMS:", error);
  dialog.showErrorBox(
    "ZCSMST PMS could not start",
    error instanceof Error ? error.message : "An unexpected startup error occurred.",
  );
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!embeddedServer || shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  embeddedServer.close()
    .catch((error) => console.error("Could not close the PMS database cleanly:", error))
    .finally(() => {
      embeddedServer = undefined;
      app.quit();
    });
});
