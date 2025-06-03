import path from "path";
import fs from "fs/promises";
import { Server as OSCServer } from "node-osc";
import WebSocket, { WebSocketServer } from "ws";
import { Client as LrcClient } from "lrclib-api";

// 型定義
type TrackInfo = { title?: string; artist?: string; sec?: number };
type LyricLine = { text: string; startTime: number };
type SyncedLyrics = LyricLine[];

// 定数
const CACHE_DIR = path.join(process.cwd(), "cache");
const OSC_PORT = 3170;
const WS_PORT = 8081;
const MAX_DISPLAY_SEC = 10; // 曲間用最大表示時間

// クライアント初期化
const lrcClient = new LrcClient();
const wss = new WebSocketServer({ port: WS_PORT });
const oscServer = new OSCServer(OSC_PORT, "0.0.0.0", () => {
  console.log(`[DEBUG] OSC Server is listening on ${OSC_PORT}`);
});

// 状態管理
let trackInfo: TrackInfo = {};
let isFetchingLyrics = false;
let latestLyrics: SyncedLyrics | null = null;

// 歌詞表示状態管理
let lastLyricText: string = "";
let lastLyricStartSec: number | null = null;
let lastLyricNextStartSec: number | null = null;
let lastLyricLineIdx: number | null = null;
let lyricHiddenUntil: number | null = null;

// --- Utility Functions ---
function sanitizeFilename(str: string): string {
  return str.replace(/[\\/:*?"<>|]/g, "_");
}

function getCachePath(title: string, artist: string): string {
  return path.join(CACHE_DIR, `${sanitizeFilename(artist)}__${sanitizeFilename(title)}.json`);
}

function binarySearchLyric(
    sec: number,
    lyrics: LyricLine[]
): { text: string; nextStartTime: number | null; thisLineIdx: number } {
  let low = 0,
      high = lyrics.length - 1,
      result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sec >= lyrics[mid].startTime) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (result === -1) {
    return { text: "", nextStartTime: lyrics[0]?.startTime ?? null, thisLineIdx: -1 };
  }
  const nextStartTime = result + 1 < lyrics.length ? lyrics[result + 1].startTime : null;
  return { text: lyrics[result].text, nextStartTime, thisLineIdx: result };
}

const broadcastLyric = (() => {
  let prevMsg = "";
  return (currentLyric: string, currentSec?: number) => {
    const payload: any = { currentLyric };
    if (currentSec !== undefined) payload.currentSec = currentSec;
    const message = JSON.stringify(payload);
    if (message === prevMsg) return;
    prevMsg = message;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  };
})();

function resetLyricDisplay() {
  lastLyricText = "";
  lastLyricStartSec = null;
  lastLyricNextStartSec = null;
  lastLyricLineIdx = null;
  lyricHiddenUntil = null;
}

// --- Lyrics Broadcast/Display Logic ---
function broadcastLyricOptimized(currentSec: number, lyrics: LyricLine[]) {
  const { text, nextStartTime, thisLineIdx } = binarySearchLyric(currentSec, lyrics);

  let hideTime: number | null = null;
  if (lastLyricStartSec !== null && lastLyricNextStartSec !== null) {
    hideTime = Math.min(lastLyricNextStartSec, lastLyricStartSec + MAX_DISPLAY_SEC);
  } else if (lastLyricStartSec !== null) {
    hideTime = lastLyricStartSec + MAX_DISPLAY_SEC;
  }

  if (thisLineIdx !== lastLyricLineIdx) {
    lyricHiddenUntil = null;
  }

  if (lyricHiddenUntil !== null && currentSec < lyricHiddenUntil) {
    return;
  }

  if (
      lastLyricText !== "" &&
      hideTime !== null &&
      currentSec >= hideTime &&
      thisLineIdx === lastLyricLineIdx
  ) {
    lastLyricText = "";
    lastLyricStartSec = null;
    lastLyricNextStartSec = null;
    lastLyricLineIdx = null;
    lyricHiddenUntil = nextStartTime ?? currentSec + 9999;
    broadcastLyric("", currentSec);
    return;
  }

  if (thisLineIdx !== -1 && thisLineIdx !== lastLyricLineIdx) {
    lastLyricText = text;
    lastLyricStartSec = lyrics[thisLineIdx]?.startTime ?? null;
    lastLyricNextStartSec = nextStartTime;
    lastLyricLineIdx = thisLineIdx;
    broadcastLyric(text, currentSec);
  }
}

// --- Lyrics Fetch/Cache Logic ---
async function fetchAndCacheLyrics(
    title: string,
    artist: string
): Promise<SyncedLyrics | null> {
  const cachePath = getCachePath(title, artist);

  // キャッシュ読み込み
  try {
    const cached = await fs.readFile(cachePath, "utf-8");
    console.log(`[DEBUG] Cache hit for lyrics: ${cachePath}`);
    return JSON.parse(cached);
  } catch {}

  // オンライン取得
  try {
    console.log(`[DEBUG] Fetching lyrics from lrclib-api: title="${title}", artist="${artist}"`);
    const syncedLyrics = await lrcClient.getSynced({
      track_name: title,
      artist_name: artist,
    });
    if (!Array.isArray(syncedLyrics) || !syncedLyrics.length) {
      console.log(`[DEBUG] No synced lyrics found`);
      await saveLyricsCache(cachePath, []);
      return [];
    }
    const filtered: LyricLine[] = syncedLyrics
        .filter((line): line is LyricLine => typeof line.startTime === "number")
        .map((line) => ({ text: line.text, startTime: line.startTime as number }));
    await saveLyricsCache(cachePath, filtered);
    console.log(`[DEBUG] Lyrics cached to: ${cachePath}`);
    return filtered;
  } catch (err) {
    console.error("[DEBUG] fetchAndCacheLyrics error:", err);
    await saveLyricsCache(cachePath, []);
    return [];
  }
}

async function saveLyricsCache(cachePath: string, data: any) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(data), "utf-8");
  } catch (e) {
    // ignore
  }
}

// --- Track/Lyric State Logic ---
async function handleTrackInfoUpdate(
    title: string,
    artist: string,
    sec: number
) {
  if (isFetchingLyrics) return;
  isFetchingLyrics = true;
  try {
    const lyrics = await fetchAndCacheLyrics(title, artist);
    if (!lyrics || lyrics.length === 0) {
      latestLyrics = [];
      resetLyricDisplay();
      broadcastLyric("", sec);
    } else {
      latestLyrics = lyrics;
      resetLyricDisplay();
      broadcastLyricOptimized(sec, lyrics);
    }
  } catch (err) {
    latestLyrics = [];
    resetLyricDisplay();
    broadcastLyric("", sec);
    console.error("[DEBUG] 歌詞取得エラー:", err);
  } finally {
    isFetchingLyrics = false;
  }
}

function resetTrackState() {
  trackInfo = { title: undefined, artist: undefined, sec: undefined };
  latestLyrics = null;
  resetLyricDisplay();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ currentLyric: "", reset: true }));
    }
  });
}

// --- OSC Event Handler ---
oscServer.on("message", async (message) => {
  const [address, ...args] = message;
  if (address !== "/time" && !address.startsWith("/beat")) {
    console.log(`[DEBUG] OSCアドレス: ${address} 引数: ${String(args[0])}`);
  }
  switch (address) {
    case "/track/master/title": {
      const newTitle = String(args[0]).replace(/^\[|\]$/g, "");
      if (trackInfo.title !== newTitle) {
        resetTrackState();
      }
      trackInfo.title = newTitle;
      break;
    }
    case "/track/master/artist": {
      trackInfo.artist = String(args[0]).replace(/^\[|\]$/g, "");
      break;
    }
    case "/time": {
      const sec = Number(String(args[0]).replace(/^\[|\]$/g, ""));
      trackInfo.sec = sec;
      if (
          trackInfo.title &&
          trackInfo.artist &&
          latestLyrics === null &&
          !isFetchingLyrics
      ) {
        await handleTrackInfoUpdate(trackInfo.title, trackInfo.artist, sec);
      }
      if (latestLyrics && latestLyrics.length > 0) {
        broadcastLyricOptimized(sec, latestLyrics);
      } else if (Array.isArray(latestLyrics) && latestLyrics.length === 0) {
        broadcastLyric("", sec);
      }
      break;
    }
  }
});