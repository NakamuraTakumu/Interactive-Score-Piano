---
title: "テンポ抽出と範囲回帰テストの失敗原因"
responsibility: "ritardando の抽出失敗と範囲表示回帰テストの誤検出について、原因と再発防止策を説明する。"
summary: "OSMDは文字だけのrit.とa tempoをBPM 0の瞬間テンポとして保持するためラベル解釈が必要であり、範囲表示テストは楽譜外クリックだけが解除操作である現行仕様へ同期した。"
created: "2026-07-26 14:26 UTC"
updated: "2026-07-26 14:26 UTC"
workspace: "/home/nakamura/gemini_piano"
related_commit: "9bd1abc11b86e6ead53bb3b6c61e4ad29b42ece3"
model: "gpt-5.6-sol"
reasoning_effort: "low"
session: "019f9eac-dcdb-77a2-a029-27965607fa67"
handling: "document-workflow"
---

# テンポ抽出と範囲回帰テストの失敗原因

## Background

簡易再生はOSMDのテンポ式からテンポマップを作り、再生範囲を含むセッション状態をReact側で管理する。
2026年7月26日の変更では、文字による `rit.` と `a tempo` を追加したが、初回実装では減速イベントが生成されなかった。
同じ回帰テストの後段は、Stop後に確定範囲が残る現行仕様を失敗として扱っていた。

## At a Glance

- OSMD 1.9.3は線を伴わない `rit.` と `a tempo` をBPM 0の瞬間テンポとして保持する。
- 文字によるテンポ指示は `ContinuousTempo` の有無ではなく、ラベルとtickを使って解釈する。
- 確定範囲を解除する利用者操作は楽譜外クリックだけであり、Stopと自然終了では範囲を維持する。
- ビルドとブラウザ回帰テストは成功している。

## Body

- [ritardandoの抽出失敗](#ritardandoの抽出失敗)
- [範囲表示テストの誤検出](#範囲表示テストの誤検出)
- [再発防止](#再発防止)
- [検証](#検証)
- [Referenced File Hashes](#referenced-file-hashes)

### ritardandoの抽出失敗

初回実装はOSMDの `ContinuousTempo` だけを漸次テンポとして抽出した。
しかし、テスト用MusicXMLの `<words>rit.</words>` と `<words>a tempo</words>` は `InstantaneousTempo` に格納され、`TempoInBpm` は0だった。
このため、数値BPMだけを採用する既存抽出と `ContinuousTempo` だけを見る追加処理のどちらも指示を採用しなかった。

修正後はテンポ式のラベルとtickを読み、`rit.` から次の `a tempo` または数値テンポまでを補間する。
`a tempo` のtickには `rit.` 開始時のBPMを復元する。

### 範囲表示テストの誤検出

回帰テストはStop後のrange overlayが0個になることを期待していた。
この期待値は、確定範囲を楽譜外クリックだけで解除する現行仕様と矛盾していた。
実装はStop時に発音中の緑表示を消し、確定範囲を維持していたため、テストだけが失敗した。

修正後のテストはStop前後のrange overlay数が同じであることを検証する。
非ループ再生の自然終了についても同じ契約を検証する。

### 再発防止

OSMDのテンポ式を追加で解釈するときは、型名だけで分類せず、実際のOSMDオブジェクトをブラウザテストで観測する。
BPM 0はテンポ値として捨てても、ラベル付き指示としては捨てない。
UI回帰テストの期待値を変更するときは、currentな仕様記録と照合する。

### 検証

`npm run build` は成功した。
`npm run test:playback` は、120 BPMから90 BPMへの減速、120 BPMへの復元、Stop後と自然終了後の範囲維持を含めて成功した。
Web MIDIの権限拒否とOSMDの幅警告はテスト環境由来であり、終了コードへ影響していない。

### Referenced File Hashes

- `document/playback-range-release-spec.md`: `sha256:935fc16c6008ca7c11dbc24f76eed926f6fbfe6079f70de326f7ded0c71b5a60`
- `src/App.tsx`: `sha256:568b05172ef9d896cd331487ce76c464a43c337cef90080511ca2c8c6a7318bd`
- `src/data/sampleScores.ts`: `sha256:d93fe9a72967496ec45fbc2ce7ba854da8eddca99cf3d833d0f8bedeee610b0c`
- `src/utils/osmdCoordinates.ts`: `sha256:8b76f9d9413a6087ca3351c7fc4cc597e8671ef765ec3a66a06a96fdd94e844b`
- `tool/playback_regression.cjs`: `sha256:83f551348149a6d48225c2cf8d221fd098fdafc1abe0bf58eb34eacb1967c740`
