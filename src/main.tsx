import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

type LyricLine = { text: string; startTime: number };

const LyricsViewer: React.FC = () => {
  const [lyric, setLyric] = useState<string>("");
  const [sec, setSec] = useState<number | null>(null);
  const [lyricLine, setLyricLine] = useState<LyricLine | null>(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8081");
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (typeof data.currentLyric === "string") {
        setLyric(data.currentLyric);
      }
      if (typeof data.currentSec === "number") {
        setSec(data.currentSec);
      }
      if (data.lyricLine) {
        setLyricLine(data.lyricLine);
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    setAnimate(false);
    const timeout = setTimeout(() => setAnimate(true), 30);
    return () => clearTimeout(timeout);
  }, [lyricLine?.startTime, lyric]);

  return (
      <div
          style={{
            width: "100vw",
            height: "100vh",
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            userSelect: "none",
          }}
      >
        {(lyricLine?.text || lyric) ? (
            <h2
                key={lyricLine?.startTime ?? lyric}
                style={{
                  color: "#fff",
                  fontSize: "4vw",
                  fontWeight: "bold",
                  textAlign: "center",
                  textShadow: "0 2px 8px #000, 0 0 2px #000",
                  opacity: animate ? 1 : 0,
                  transform: animate ? "translateY(0)" : "translateY(-20px)",
                  transition: "opacity 0.5s, transform 0.5s",
                  margin: 0,
                  padding: "0.5em 1em",
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: "0.5em",
                  maxWidth: "90vw",
                  overflowWrap: "break-word",
                }}
            >
              {lyricLine ? lyricLine.text : lyric}
            </h2>
        ) : null}
        {/* 必要なら時刻を小さく表示
      {sec !== null && (
        <div style={{
          position: "absolute",
          bottom: 10,
          right: 20,
          color: "#fff",
          fontSize: "1vw",
          textShadow: "0 1px 4px #000",
          opacity: 0.7,
        }}>
          時刻: {sec} 秒
        </div>
      )} */}
      </div>
  );
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <LyricsViewer />
);