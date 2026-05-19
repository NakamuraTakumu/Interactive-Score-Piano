# Score Playback Specification

- Created: 2026-05-19 13:08 UTC
- Updated: 2026-05-19 18:22 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e4058-0985-7fc3-a4ea-c3d5003b4144
- Repository: /home/nakamura/gemini_piano
- Related-Commit: 7b79a48d8a4d4fa65143cdcb3ac85293a6f297b1

Responsibility: 表示中の楽譜を簡単に再生する v1 機能の範囲、状態、データ、UI、受け入れ条件を定義する。

## Background

表示中の MusicXML 楽譜を、手動クリックとは別に Play ボタンから簡易再生したい。既存の autoplay feasibility note は、音声出力よりもタイムライン、スケジューリング、UI 状態の分離が難所であることを示している。

## Result

### V1 Scope

- **目的**: 現在表示している楽譜を、ユーザー操作で全体またはドラッグ選択範囲だけ簡易再生する。
- **対象楽譜**: 既に OSMD で表示できる `.mxl`, `.xml`, `.musicxml`。
- **開始条件**: Play button などの明示的な user gesture で開始する。
- **音源**: 既存の `usePianoSound()` と現在選択中の SoundFont / GM program / volume / transpose 設定を使う。
- **テンポ**: 楽譜から score BPM を抽出できる場合はそれを既定値にする。抽出できない場合は UI 設定の BPM を使う。BPM control の範囲は 40-200 BPM。
- **再生範囲**: Play button は表示中スコアの先頭から末尾まで再生する。楽譜上の drag は mouseup で範囲を確定し、その範囲だけ再生する。
- **譜面同期**: 現在鳴っている column は既存の click selection と同じ緑の note / measure highlight として表示する。
- **精度方針**: v1 は「簡易再生」であり、譜面確認用の近似再生を提供する。MusicXML の完全な playback semantics は保証しない。

### Non-Scope

- MusicXML の tempo change, repeat, jump, coda, fine, pedal, articulation, swing, instrument change は v1 では解釈しない。
- 楽譜を開いただけで自動再生しない。
- MIDI 入力の練習判定や追従再生は扱わない。
- 正式な SMF export / import は扱わない。

### UI Contract

- **Play/Pause button**: stopped または paused なら再生を開始または再開し、playing なら pause する。
- **Stop button**: 再生中の全 note を止め、再生位置と cursor を先頭に戻す。
- **BPM control**: 40-200 BPM の slider または number input。playing 中の変更は次の scheduling window から反映する。
- **Score BPM default**: timeline 抽出で `scoreBpm` が得られた場合、BPM control の値をその BPM に合わせる。
- **Drag range playback**: 楽譜上の left mouse drag は音符有無にかかわらず timestamp column から範囲選択 preview を表示し、drag 中は発音しない。left mouse up で選択範囲内を現在の BPM で再生する。
- **Two-dimensional range selection**: drag range は横方向の timestamp column 範囲と縦方向の staff 範囲を持つ。右手譜表または左手譜表だけを選択した場合、範囲再生はその譜表の note だけを対象にする。
- **Drag during playback**: playback 中でも drag range selection を受け付ける。既存の範囲 overlay が新しい drag preview に置き換わる場合は、既存の範囲再生を止める。mouseup 後は新しい範囲再生へ切り替える。確定した範囲の小節領域 overlay は、その範囲再生が続く間は残す。
- **Click preview**: 単一 click は従来どおり一つの note column の音だけ短く鳴らす。緑の score note 装飾は click 後に保持しない。
- **Disabled state**: scoreData がない、audio 初期化中、SoundFont 未ロード中、timeline 抽出失敗時は Play を disabled にする。
- **Score change**: score selection, upload, delete, visualTranspose change で再生を stop し、timeline を作り直す。
- **End of score**: 最後の note-off を処理したら `stopped` に戻し、発音中 note と cursor を消し、次の Play は先頭から始める。
- **User-facing label**: UI では `Simple playback` または同等の短い label を使い、完全な MusicXML 再生ではないことを示す。
- **Placement**: Play/Pause, Stop, BPM は score selector と音量 control の近くに置く。設定 popover 内ではなく、再生中に常時操作できる場所に置く。
- **Timeline failure**: timeline 抽出に失敗した場合は control 近くに短い error text を表示し、click selection と MIDI 入力は通常どおり使える状態に保つ。

### Playback State

`activeNotes` は引き続き MIDI 入力だけを表す。自動再生は別 state として持つ。

```ts
type PlaybackStatus = 'stopped' | 'playing' | 'paused';

interface PlaybackState {
  status: PlaybackStatus;
  currentTick: number;
  currentColumnKey: string | null;
  activeDisplayNotes: Set<number>;
}
```

### Timeline Model

`extractMeasureContexts()` は現状どおり座標と column selection 用に残す。再生用には別に `extractPlaybackTimeline()` を追加し、少なくとも次の情報を持つ。

```ts
interface PlaybackNoteEvent {
  id: string;
  type: 'note-on' | 'note-off';
  tick: number;
  columnKey: string;
  measureNumber: number;
  systemId: number;
  staffId: number;
  sourceMidi: number;
  displayMidi: number;
  durationTicks?: number;
}

interface PlaybackTimeline {
  ppq: number;
  durationTicks: number;
  events: PlaybackNoteEvent[];
  scoreBpm?: number;
}
```

- `sourceMidi`: MusicXML / OSMD から得た元 pitch。
- `displayMidi`: `sourceMidi + visualTranspose`。score highlight と keyboard highlight はこれを見る。
- actual synth pitch: `displayMidi + settings.transpose` を再生直前に clamp して使う。
- `columnKey`: score cursor と既存 column overlay との接続点にする。
- `durationTicks`: note-on event 側では抽出できた note duration を保持する。note-off event 側では省略してよい。
- `scoreBpm`: MusicXML / OSMD から抽出できた楽譜上の代表 BPM。抽出できない場合は省略する。

### Range Selection Model

楽譜上の drag は、単一 column selection とは別の範囲 contract を使う。

```ts
interface ScoreRangeSelection {
  startColumnKey: string;
  endColumnKey: string;
  columnKeys: string[];
  selectedStaffKeys: string[];
}
```

- `columnKeys` は `startColumnKey` と `endColumnKey` を含む表示順の column key 群にする。
- `selectedStaffKeys` は `systemId:measureNumber:staffId` 形式で、drag 矩形が含む staff measure を表す。
- drag 開始位置に音符がない場合でも、OSMD timestamp hit-test または同一小節内の最寄り column を使って `startColumnKey` を決める。
- playback 中の drag も同じ contract を使い、既存の playback state は範囲確定時に置き換える。
- playback 中に保持する範囲装飾は、App 側の playback state に紐づく `ScoreRangeSelection` を正とする。
- 範囲再生では `columnKeys` 内かつ `selectedStaffKeys` に一致する note-on events を対象にし、それらの note-off tick までを再生終端にする。
- drag 後に発生する synthetic click では単一 column preview を走らせない。

### Timeline Extraction Rules

- `extractPlaybackTimeline()` は OSMD の source measure / voice entry / note duration から timeline を作る。duration を取得できない note は v1 では skipped note として扱い、timeline failure にはしない。
- tick の基準は timeline 内で固定する。推奨値は `ppq = 480`。
- `events` は tick 昇順に並べ、`durationTicks` は最後の note-off tick 以上にする。
- chord は同じ `tick` と `columnKey` を共有する複数 note-on / note-off event として表す。
- rest は発音 event を作らないが、後続 note の `tick` を進めるために duration として反映する。
- 複数 voice がある場合は、voice ごとに tick を進め、最終的に全 event を `tick`, event order, `id` で安定 sort する。
- tie は v1 では同じ pitch の連続 note を結合できる場合だけ結合する。結合できない tie は通常 note として扱う。
- grace note, ornament, cue note, hidden note は v1 では発音 event を作らない。
- timeline 抽出時は repeat / jump を展開しない。表示順に現れる measure を一度だけ読む。
- staff, system, measure, `columnKey` は既存の `MeasureContext` と同じ key 空間の値を使い、cursor 描画が座標 model へ戻れるようにする。
- 同一 `systemId`, `measureNumber`, `columnKey` に複数 staff / voice の note がある場合は、cursor では一つの column group として扱う。

### Scheduling

- 再生開始時に `startAudio()` を呼び、AudioContext が running になってから schedule する。
- v1 は短い lookahead loop で `midiNoteOn` / `midiNoteOff` を送る。`playNotes()` の固定 500ms timeout は autoplay には使わない。
- pause / stop / score change / component unmount では、scheduled timer を止め、鳴っている note へ `midiNoteOff` または `midiAllSoundsOff` を送る。
- note-on と note-off が同 tick に並ぶ場合は、note-off を先に処理して同音連打の詰まりを避ける。
- pause は現在 tick を保持するが、pause 時点で鳴っていた長い note を resume 時に途中から鳴らし直さない。v1 の resume は次に到達する note-on から発音を再開する。
- pause 時の `currentTick` は「停止操作を受けた時点の再生 tick」とする。resume では `currentTick` 以上の未処理 event から scheduling を再開する。
- stopped または score change では playback state の `activeDisplayNotes` を空にし、cursor を消す。
- 範囲再生では `startTick` 以上、範囲終端 tick 以下の events を処理し、終端到達時に通常の stop と同じ cleanup を行う。

### Visual Behavior

- playback 中の score 表示は緑を使い、余分な autoplay 専用色を増やさない。
- 範囲再生中の range overlay は、選択された再生範囲そのものを示す。range overlay を解除する状態遷移では、対応する範囲再生も止める。
- drag range preview は、既存 score guide line と同系の控えめな green overlay とし、column ごとの細い帯ではなく、選択範囲の始点 x から終点 x までの小節領域を連続して覆う。
- drag range preview は、選択された staff measure だけを覆う。片手譜表だけを選択した場合、もう片方の譜表には range overlay を出さない。
- 緑の score note 装飾は playback 中の発音中 notehead だけに使い、範囲選択そのものでは notehead を着色しない。
- drag 中は playback column highlight より drag range overlay を優先する。
- 範囲再生中は、確定済み範囲の小節領域 overlay を緑で残す。notehead は現在発音中のものだけ緑にする。
- 優先順位は live MIDI active note red, playback active note green, black-key hint の順にする。
- PianoKeyboard は click selection と playback active notes を同じ `highlightNotes` として受け取り、どちらも緑で示す。
- 同じ key が複数 state に属する場合の優先順位は MIDI input red, click / playback highlight green, scale hint の順にする。

### Acceptance Criteria

1. sample score を開いて Play を押すと、音が鳴り、score cursor が再生位置に沿って進む。
2. Pause を押すと発音中の note が止まり、再度 Play で同じ位置から再開する。
3. Stop を押すと発音中の note が止まり、cursor が消え、次の Play は先頭から始まる。
4. 再生中に score を変更すると stop し、新しい score の timeline が用意される。
5. click selection の試聴、MIDI 入力 highlight、guide line は autoplay 追加後も既存の意味を保つ。
6. `visualTranspose` と `transpose` を同時に使っても、score cursor / keyboard highlight / 実際の発音 pitch が仕様どおり一致する。
7. duration を取得できない note が含まれても、取得できた note だけで再生でき、UI は timeline failure ではなく簡易再生として継続する。
8. pause 中に score cursor と playback keyboard highlight は停止し、resume 後は次の note-on から発音が戻る。
9. 曲末到達後は残音がなく、status は `stopped`、cursor は非表示、次の Play は先頭から始まる。
10. `events` は tick 昇順で、同一 tick では note-off が note-on より先に処理される。
11. SoundFont 未ロード中または timeline 抽出失敗中は Play が disabled になり、既存の click selection と MIDI 入力は壊れない。
12. 再生中の BPM 変更は次の scheduling window から反映される。
13. component unmount, score change, Stop の後に発音中 note が残らない。
14. 楽譜に BPM がある場合、初期 BPM control はその値になる。抽出できない場合は既定 BPM を使う。
15. 楽譜上を drag している間は発音せず、mouseup 後だけ選択範囲が現在の BPM で再生される。
16. drag 後の synthetic click で単一 column preview が重複して鳴らない。
17. 範囲再生中、楽譜上の現在 column と下部 keyboard は click selection と同じ緑で同期表示される。
18. 音符がない位置から drag を開始しても、同一小節内の timestamp column を始点として範囲選択が始まる。
19. playback の pause / stop / score change 後、緑の score note 装飾と keyboard highlight は残らない。
20. playback 中に drag しても範囲 preview が表示され、mouseup 後にその範囲の playback へ切り替わる。
21. 範囲確定後、その範囲の小節領域 overlay は playback 中ずっと残り、pause / stop / score change / playback end で消える。
22. 範囲選択によって notehead は着色されず、notehead が緑になるのは対応する playback note が発音中の間だけである。
23. 二段譜で右手譜表または左手譜表だけを drag 選択した場合、範囲 overlay と範囲再生は選択された譜表だけに限定される。

## Detail

既存実装では `activeNotes` が MIDI 入力、`selected` が click selection を表している。autoplay をこのどちらかへ混ぜると highlight の意味が崩れるため、playback 専用 state を追加する。

既存の `document/autoplay-feasibility-notes.md` は、現在の score model が空間情報中心で、再生 timeline に必要な duration や voice ordering を持たないことを記録している。この仕様はその前提を受け、v1 で扱う MusicXML 再生解釈を意図的に狭くする。

関連する実装入口:

- `src/App.tsx`: playback state と transport handler の所有。
- `src/hooks/usePianoSound.ts`: synth への note scheduling API 追加。
- `src/components/ControlPanel.tsx`: Play / Pause / Stop / BPM controls 追加。
- `src/components/ScoreDisplay.tsx`: playback column highlight、drag range preview、範囲確定 callback。
- `src/utils/osmdCoordinates.ts`: score column と playback timeline の対応。
- `src/types/piano.ts`: playback timeline / state type の追加。

## References
