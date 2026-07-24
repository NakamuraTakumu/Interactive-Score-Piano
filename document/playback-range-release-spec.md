---
title: "再生範囲の解除"
responsibility: "再生範囲を解除する唯一の利用者操作と、解除時の再生状態を定める。"
created: "2026-07-24 16:08 UTC"
updated: "2026-07-24 16:08 UTC"
workspace: "/home/nakamura/gemini_piano"
related_commit: "d3694635c73498d9c159e893c0cb0b6aa00c2bc3"
model: "GPT-5"
reasoning_effort: "unavailable"
session: "unavailable"
handling: "document-workflow"
---

# 再生範囲の解除

## 利用者操作

確定済みの再生範囲を利用者が解除する操作は、楽譜コンポーネント外のクリックだけとする。

Stop、曲末到達、Pause、再生バーのドラッグでは、確定済みの再生範囲を解除しない。

確定済みの範囲外への再生バードラッグは受け付けない。

## 解除時の再生

楽譜外クリックで範囲再生を解除した場合は、発音中の音を止める。

解除時の再生バー位置は保持する。

### Referenced File Hashes

- `src/App.tsx`: `sha256:568b05172ef9d896cd331487ce76c464a43c337cef90080511ca2c8c6a7318bd`
- `src/components/ScoreDisplay.tsx`: `sha256:be138b787e9ec11b2f10bacda68c9af3758b2ee331812bea0f3b5ce86f0a83ec`
