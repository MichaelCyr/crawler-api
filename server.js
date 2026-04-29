const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const archiver = require("archiver");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MAX_PAGES = 10;

// 🔧 helper: check same domain
function sameDomain(url, base) {
  try {
    return new URL(url).hostname === new URL(base).hostname;
  } catch {
    return false;
  }
}

// 🌐 homepage (fixes "Cannot GET /")
app.get("/", (req, res) => {
  res.send("🔥 HTTrack Pro API is running!");
});

// 🧠 main crawler endpoint
app.post("/clone", async (req, res) => {
  const startUrl = req.body.url;
  if (!startUrl) return res.status(400).send("No URL provided");

  const id = Date.now().toString();
  const root = path.join(__dirname, "site", id);
  const assetsDir = path.join(root, "assets");

  await fs.ensureDir(assetsDir);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  let queue = [startUrl];
  let visited = new Set();

  console.log("🕷 Starting crawl:", startUrl);

  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

      const html = await page.content();
      const $ = cheerio.load(html);

      let fileName = url
        .replace(startUrl, "")
        .replace(/[^a-z0-9]/gi, "_");

      if (!fileName || fileName === "_") fileName = "index";

      const filePath = path.join(root, fileName + ".html");

      // 🔗 collect links
      $("a[href]").each((_, el) => {
        const link = $(el).attr("href");
        try {
          const full = new URL(link, url).href;
          if (sameDomain(full, startUrl) && !visited.has(full)) {
            queue.push(full);
          }
        } catch {}
      });

      // 📦 assets
      const assets = [];
      $("img[src]").each((_, el) => assets.push($(el).attr("src")));
      $("script[src]").each((_, el) => assets.push($(el).attr("src")));
      $("link[href]").each((_, el) => assets.push($(el).attr("href")));

      const map = {};

      for (const a of assets) {
        try {
          const full = new URL(a, url).href;

          const name = path.basename(full.split("?")[0]);
          const dest = path.join(assetsDir, name);

          const r = await axios.get(full, { responseType: "arraybuffer" });
          await fs.writeFile(dest, r.data);

          map[full] = "assets/" + name;
        } catch {}
      }

      let finalHtml = $.html();

      for (const [orig, local] of Object.entries(map)) {
        finalHtml = finalHtml.split(orig).join(local);
      }

      await fs.writeFile(filePath, finalHtml);

    } catch (e) {
      console.log("❌ Failed:", url);
    }
  }

  await browser.close();

  // 📦 ZIP result
  const zipPath = root + ".zip";
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip");

  archive.pipe(output);
  archive.directory(root, false);
  await archive.finalize();

  output.on("close", () => {
    res.download(zipPath);
  });
});

app.listen(PORT, () => {
  console.log("🚀 HTTrack Pro running on port", PORT);
});
