# Score Playback Specification

- Created: 2026-05-19 13:08 UTC
- Updated: 2026-06-01 14:16 UTC
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
- **テンポ**: 楽譜から数値 BPM の tempo map を抽出し、再生 tick は tempo map に従って進める。抽出できない場合は 100 BPM を使う。ユーザーは BPM を直接指定せず、速度倍率 `0.5x-2.0x` を変更する。
- **再生範囲**: Play button は表示中スコアの先頭から末尾まで再生する。楽譜上の drag は mouseup で範囲を確定し、その範囲だけ再生する。
- **ループ**: Loop toggle が ON の場合、全体再生と範囲再生の終端で同じ再生範囲を繰り返す。Loop toggle は保存され、OFF が既定値である。
- **譜面同期**: 現在鳴っている column は既存の click selection と同じ緑の note / measure highlight として表示する。
- **精度方針**: v1 は「簡易再生」であり、譜面確認用の近似再生を提供する。MusicXML の完全な playback semantics は保証しない。

### Non-Scope

- MusicXML の repeat, jump, coda, fine, pedal, fermata, tenuto, swing, instrument change は v1 では解釈しない。テンポは数値 BPM が読める tempo expression / sound tempo だけを扱い、`rit.` / `accel.` など文字だけの漸次変化は解釈しない。`accent`、`strong-accent` 系、`staccato`、`staccatissimo` は簡易 articulation として既存 note-on / note-off を変形する。
- 楽譜を開いただけで自動再生しない。
- MIDI 入力の練習判定や追従再生は扱わない。
- 正式な SMF export / import は扱わない。

### UI Contract

- **Play/Pause button**: stopped または paused なら再生を開始または再開し、playing なら pause する。
- **Stop button**: 再生中の全 note を止め、再生位置と cursor を先頭に戻す。
- **Loop button**: 全体再生と範囲再生の loop ON / OFF を切り替える。切り替えは再生を開始、停止、一時停止しない。playing 中の変更は次の終端到達時から反映する。
- **Speed control**: `0.5x-2.0x` の速度倍率 slider を持つ。playing 中の変更は現在 tick を維持して scheduler を張り直し、次の scheduling window から反映する。
- **Score tempo display**: score load 後の timeline 抽出で得られた `tempoEvents` を読み取り専用で表示する。複数テンポがある場合は最小 BPM と最大 BPM の範囲を表示する。
- **Drag range playback**: 楽譜上の left mouse drag は音符有無にかかわらず timestamp column から範囲選択 preview を表示し、drag 中は発音しない。preview は pointer が drag threshold を超えた時点で始め、同一 column 内の drag でも小節領域 overlay を表示する。left mouse up で選択範囲内を譜面 tempo map と現在の速度倍率で再生する。
- **Two-dimensional range selection**: drag range は横方向の timestamp column 範囲と縦方向の staff 範囲を持つ。右手譜表または左手譜表だけを選択した場合、範囲再生はその譜表の note だけを対象にする。
- **Drag during playback**: playback 中でも drag range selection を受け付ける。既存の範囲 overlay が新しい drag preview に置き換わる場合は、既存の範囲再生を止める。mouseup 後は新しい範囲再生へ切り替える。確定した範囲の小節領域 overlay は、その範囲再生が続く間は残す。
- **Click preview**: 単一 click は従来どおり一つの note column の音だけ短く鳴らす。緑の score note 装飾は click 後に保持しない。
- **Disabled state**: scoreData がない、audio 初期化中、SoundFont 未ロード中、timeline 抽出失敗時は Play を disabled にする。
- **Score change**: score selection, upload, delete, visualTranspose change で再生を stop し、timeline を作り直す。
- **Score layout**: score layout は楽譜ごとの属性ではなく、全楽譜に適用される global setting とする。
- **Timeline generation**: score data, visualTranspose, resize による timeline 再抽出は generation を持ち、古い非同期結果は採用しない。
- **End of score**: Loop OFF では最後の note-off を処理したら `stopped` に戻し、発音中 note と cursor を消し、次の Play は先頭から始める。Loop ON では発音中 note を止め、同じ session のまま先頭から再開する。
- **User-facing label**: UI では `Simple playback` または同等の短い label を使い、完全な MusicXML 再生ではないことを示す。
- **Placement**: Play/Pause, Stop, Speed は score selector と音量 control の近くに置く。設定 popover 内ではなく、再生中に常時操作できる場所に置く。
- **Timeline failure**: timeline 抽出に失敗した場合は control 近くに短い error text を表示し、click selection と MIDI 入力は通常どおり使える状態に保つ。

### Playback Session

`activeNotes` は引き続き MIDI 入力だけを表す。自動再生は、transport、範囲 overlay、発音中 notehead、keyboard highlight の唯一の正とする `PlaybackSession` として持つ。

```ts
type PlaybackStatus = 'stopped' | 'playing' | 'paused';
type PlaybackMode = 'full' | 'range';

interface PlaybackSchedulerState {
  startTick: number;
  startTime: number;
  nextEventIndex: number;
  loopStartTick: number;
  loopStartEventIndex: number;
  rangeEndTick: number | null;
  allowedEventIds: Set<string> | null;
  timelineGeneration: number | null;
}

interface PlaybackSession {
  id: number;
  status: PlaybackStatus;
  mode: PlaybackMode;
  range: ScoreRangeSelection | null;
  tick: number;
  currentColumnKey: string | null;
  activeEvents: Map<string, PlaybackNoteEvent>;
  scheduler: PlaybackSchedulerState;
}
```

- `range`: 確定済み range overlay の正とする。range overlay を消す遷移では、対応する範囲再生も止める。
- `activeEvents`: 発音中 notehead の正とする。score notehead は `noteIdentities` で特定し、layout key や pitch field を identity として使わない。
- `currentColumnKey`: column cursor の正とする。発音中 notehead 判定には使わない。
- `scheduler`: scheduler lifecycle の正とする。再生 clock、次 event index、range 終端、range filter は session と同じ lifecycle で更新する。
- `loopStartTick` / `loopStartEventIndex`: loop 再開位置の正とする。全体再生は score 先頭、範囲再生は選択範囲の最初の playable event を指す。
- `id`: session lifecycle の世代管理に使う。非同期 `startAudio()` 完了後に古い開始要求が UI を復活させないことは、別の start token で保証する。

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
  noteIdentity: string;
  noteIdentities: string[];
  sourceMidi: number;
  soundingMidi: number;
  renderedMidi: number;
  durationTicks?: number;
  velocityRatio?: number;
}

interface PlaybackTimeline {
  ppq: number;
  durationTicks: number;
  events: PlaybackNoteEvent[];
  tempoEvents: PlaybackTempoEvent[];
  generation?: number;
}

interface PlaybackTempoEvent {
  tick: number;
  bpm: number;
}
```

- `sourceMidi`: MusicXML / OSMD から得た元 pitch。`visualTranspose` 適用前に source note から採取し、描画後の `NoteDetail.midi` から埋めない。
- `noteIdentity`: source note と rendered notehead を対応づける代表識別子。単独 note の互換用に残す。
- `noteIdentities`: 発音中に highlight する rendered notehead 識別子群。tie chain では chain 内の全 notehead を含め、slur では増やさない。
- `renderedMidi`: 現在描画されている譜面上の pitch。score projection と notehead state の pitch として扱う。
- `soundingMidi`: 再生対象の pitch。v1 では `renderedMidi` と同じ値を使い、actual synth pitch は `soundingMidi + settings.transpose` を再生直前に clamp して使う。
- `columnKey`: score cursor と既存 column overlay との接続点にする。
- `durationTicks`: note-on event 側では抽出できた note duration を保持する。note-off event 側では省略してよい。
- `velocityRatio`: note-on event 側で MIDI velocity の倍率を保持する。未指定の場合は既定の簡易再生 velocity を使う。
- `tempoEvents`: MusicXML / OSMD から抽出した数値 tempo map。譜面上の数値 BPM 変更を絶対 tick に変換して保持し、抽出できない場合は `{ tick: 0, bpm: 100 }` を入れる。

### Range Selection Model

楽譜上の drag は、単一 column selection とは別の範囲 contract を使う。

```ts
type StaffScope =
  | { type: 'all' }
  | { type: 'staffs'; staffIds: number[] };

interface ScoreRangeDraft {
  startColumnKey: string;
  endColumnKey: string;
  columnKeys: string[];
  staffScope: StaffScope;
}

interface ScoreRangeSelection extends ScoreRangeDraft {}
```

- `columnKeys` は `startColumnKey` と `endColumnKey` を含む表示順の column key 群にする。
- drag 中は `ScoreRangeDraft` を使い、mouseup 後に `ScoreRangeSelection` として確定する。playback が参照する正本は確定済み range のみとする。
- `staffScope` は stable staff lane を表す。片手譜表だけを選択した場合は `{ type: 'staffs', staffIds: [...] }` とし、全譜表を意図する場合だけ `{ type: 'all' }` を使う。
- drag 開始位置に音符がない場合でも、OSMD timestamp hit-test または同一小節内の最寄り column を使って `startColumnKey` を決める。
- playback 中の drag も同じ contract を使い、既存の playback state は範囲確定時に置き換える。
- playback 中に保持する範囲装飾は、App 側の playback state に紐づく `ScoreRangeSelection` を正とする。
- 範囲再生では `columnKeys` 内かつ `staffScope` に一致する note-on events を対象にし、それらの note-off tick までを再生終端にする。
- drag 後に発生する synthetic click では単一 column preview を走らせない。

### Timeline Extraction Rules

- `extractPlaybackTimeline()` は OSMD の source measure / voice entry / note duration から timeline を作る。duration を取得できない note は v1 では skipped note として扱い、timeline failure にはしない。
- tick の基準は timeline 内で固定する。推奨値は `ppq = 480`。
- `events` は tick 昇順に並べ、`durationTicks` は最後の note-off tick 以上にする。
- chord は同じ `tick` と `columnKey` を共有する複数 note-on / note-off event として表す。
- rest は発音 event を作らないが、後続 note の `tick` を進めるために duration として反映する。
- 複数 voice がある場合は、voice ごとに tick を進め、最終的に全 event を `tick`, event order, `id` で安定 sort する。
- tie は OSMD の `sourceNote.NoteTie.notes` を使い、chain 先頭の note-on と chain 末尾の note-off に畳む。chain 途中の note は再アタックせず、発音中は chain 内の notehead を同時に緑 highlight する。slur は v1 では再生用に解釈せず、legato 化や note overlap 調整を行わない。
- `accent`、`strong-accent` 系は note-on event の `velocityRatio` を上げる。`staccato`、`staccatissimo` は note-off tick を単純に前へ動かす。後続 event 全体の tick はずらさない。
- grace note, ornament, cue note, hidden note は v1 では発音 event を作らない。
- timeline 抽出時は repeat / jump を展開しない。表示順に現れる measure を一度だけ読む。
- staff, system, measure, `columnKey` は既存の `MeasureContext` と同じ key 空間の値を使い、cursor 描画が座標 model へ戻れるようにする。
- 同一 `systemId`, `measureNumber`, `columnKey` に複数 staff / voice の note がある場合は、cursor では一つの column group として扱う。

### Scheduling

- 再生開始時に `startAudio()` を呼び、AudioContext が running になってから schedule する。
- playback session は開始時点の timeline generation を持つ。再生中に timeline generation が変わった場合、旧 scheduler を新 timeline に適用せず playback を止める。
- v1 は短い lookahead loop で `midiNoteOn` / `midiNoteOff` を送る。`playNotes()` の固定 500ms timeout は autoplay には使わない。
- pause / stop / score change / component unmount では、scheduled timer を止め、鳴っている note へ `midiNoteOff` または `midiAllSoundsOff` を送る。
- note-on と note-off が同 tick に並ぶ場合は、note-off を先に処理して同音連打の詰まりを避ける。
- pause は現在 tick を保持するが、pause 時点で鳴っていた長い note を resume 時に途中から鳴らし直さない。v1 の resume は次に到達する note-on から発音を再開する。
- pause 時の `currentTick` は「停止操作を受けた時点の再生 tick」とする。resume では `currentTick` 以上の未処理 event から scheduling を再開する。
- stopped または score change では `PlaybackSession.activeEvents` を空にし、cursor と range overlay を消す。
- Loop OFF の範囲再生では `startTick` 以上、範囲終端 tick 以下の events を処理し、終端到達時に通常の stop と同じ cleanup を行う。
- Loop ON の終端到達時は、発音中 note を止め、`PlaybackSession.id` と確定済み `range` を維持したまま `loopStartTick` / `loopStartEventIndex` へ scheduler を戻す。score change, timeline generation change, range invalidation は loop より優先して stop する。
- 範囲確定後に再生可能 note がない場合は、既存 playback を停止し、transport を stopped session に戻す。range validation error は timeline failure とは分け、全体 Play を恒久的に disabled にしない。
- playback note-on は session/token がまだ有効な場合だけ synth へ送る。停止後に非同期 audio 初期化が解決しても、古い note-on は鳴らさない。
- `PlaybackSession.activeEvents` には、audio note-on が現行 session で受理された note だけを入れる。audio 側の実音状態と score 上の active event を暗黙に二重管理しない。
- `startAudio()` は進行中の audio / SoundFont 初期化 promise を待つ。AudioContext と synth object が存在していても SoundFont load 中なら、scheduler は準備済みとして進めない。
- scheduler tick は session id と start token が現行 playback と一致する場合だけ進める。停止後に遅れて走った timer callback は何もしない。
- `startAudio()` が失敗した場合は playback error として表示し、transport を stopped session に戻す。
- playback 中に SoundFont 読み込みが始まった場合は再生を停止する。

### Visual Behavior

- playback 中の score 表示は緑を使い、余分な autoplay 専用色を増やさない。
- 範囲再生中の range overlay は、選択された再生範囲そのものを示す。range overlay を解除する状態遷移では、対応する範囲再生も止める。
- drag range preview は、既存 score guide line と同系の控えめな green overlay とし、column ごとの細い帯ではなく、選択範囲の始点 x から終点 x までの小節領域を連続して覆う。
- drag range preview は、選択された staff measure だけを覆う。片手譜表だけを選択した場合、もう片方の譜表には range overlay を出さない。
- 緑の score note 装飾は `PlaybackSession.activeEvents` に含まれる発音中 notehead だけに使い、範囲選択そのものでは notehead を着色しない。
- notehead の色は `NoteVisualState` resolver で決める。優先順位は live MIDI active red, playback active green, black-key hint, original style の順とし、OSMD DOM mutation は resolver の結果を反映する adapter に閉じる。
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
12. 再生中の速度倍率変更は次の scheduling window から反映される。
13. component unmount, score change, Stop の後に発音中 note が残らない。
14. 楽譜に数値 BPM がある場合、tempo map はその値を保持し、UI は読み取り専用 tempo と速度倍率を表示する。抽出できない場合は 100 BPM を使う。
15. 楽譜上を drag している間は発音せず、mouseup 後だけ選択範囲が譜面 tempo map と現在の速度倍率で再生される。
16. drag 後の synthetic click で単一 column preview が重複して鳴らない。
17. 範囲再生中、楽譜上の現在 column と下部 keyboard は click selection と同じ緑で同期表示される。
18. 音符がない位置から drag を開始しても、同一小節内の timestamp column を始点として範囲選択が始まる。
19. playback の pause / stop / score change 後、緑の score note 装飾と keyboard highlight は残らない。
20. playback 中に drag しても範囲 preview が表示され、mouseup 後にその範囲の playback へ切り替わる。
21. 範囲確定後、その範囲の小節領域 overlay は range session の playing / paused 中に残り、stop / score change / playback end で消える。
22. 範囲選択によって notehead は着色されず、notehead が緑になるのは対応する playback note が発音中の間だけである。
23. 二段譜で右手譜表または左手譜表だけを drag 選択した場合、範囲 overlay と範囲再生は選択された譜表だけに限定される。
24. UI regression test は、drag 中の range overlay、mouseup 後の range overlay、演奏中の score notehead green、演奏中の keyboard green を DOM または screenshot で確認する。
25. Loop toggle が ON の場合、全体再生と範囲再生は終端到達後に同じ範囲を繰り返す。
26. 範囲 loop 中は range overlay が維持され、Stop 後は range overlay、score notehead green、keyboard green が消える。
27. Loop toggle が OFF の場合、全体再生と範囲再生は終端で停止する。

## Detail

既存実装では `activeNotes` が MIDI 入力、`selected` が click selection を表している。autoplay をこのどちらかへ混ぜると highlight の意味が崩れるため、playback 専用 state を追加する。

既存の `document/autoplay-feasibility-notes.md` は、現在の score model が空間情報中心で、再生 timeline に必要な duration や voice ordering を持たないことを記録している。この仕様はその前提を受け、v1 で扱う MusicXML 再生解釈を意図的に狭くする。

関連する実装入口:

- `src/App.tsx`: playback state と transport handler の所有。
- `src/hooks/usePianoSound.ts`: synth への note scheduling API 追加。
- `src/components/ControlPanel.tsx`: Play / Pause / Stop / Speed controls 追加。
- `src/components/ScoreDisplay.tsx`: playback column highlight、drag range preview、範囲確定 callback。
- `src/utils/osmdCoordinates.ts`: score column と playback timeline の対応。
- `src/types/piano.ts`: playback timeline / state type の追加。

## References
