const { db } = require("../handlers/db.js");
const config = require("../config.json");
const { v4: uuidv4 } = require("uuid");
const log = new (require("cat-loggr"))();

async function init() {
  const ojihost = await db.get("ojihost_instance");
  if (!ojihost) {
    log.init("This is probably your first time starting OJIHOST, welcome!");
    log.init("Thank you for using OJIHOST Panel!");

    const errorMessages = [];

    let imageCheck = await db.get("images");
    let userCheck = await db.get("users");

    if (!imageCheck) {
      errorMessages.push(
        "Before starting OJIHOST for the first time, you didn't run the seed command!"
      );
      errorMessages.push("Please run: npm run seed");
    }

    if (!userCheck) {
      errorMessages.push(
        "If you didn't do it already, make a user for yourself: npm run createUser"
      );
    }

    if (errorMessages.length > 0) {
      errorMessages.forEach((errorMsg) => log.error(errorMsg));
      process.exit();
    }

    const ojihostId = uuidv4();
    const setupTime = Date.now();

    const info = {
      ojihostId: ojihostId,
      setupTime: setupTime,
      originalVersion: config.version,
    };

    await db.set("ojihost_instance", info);
    log.info("Initialized OJIHOST panel with ID: " + ojihostId);
  }
  log.info("Init complete!");
}

module.exports = { init };
