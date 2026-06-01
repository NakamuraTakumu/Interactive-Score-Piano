# Score Playback Design Review

- Created: 2026-05-24 05:50 UTC
- Updated: 2026-05-24 07:27 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e4058-0985-7fc3-a4ea-c3d5003b4144
- Repository: /home/nakamura/gemini_piano
- Related-Commit: 3f85449fa14ac3e0aac1698b37b5bb51e202b6e3

Responsibility: 楽譜再生、範囲選択、音符着色に関する software design 上の問題を、後続修正で参照できる網羅的な findings として整理する。

## Background

楽譜の簡易再生、範囲選択、発音中 notehead 着色を実装した後、複数サブエージェントへ機能別の read-only 設計レビューを依頼した。

## Result

### Summary

複数レビューの結論は、現在の実装が **source score model**, **layout coordinate model**, **playback runtime**, **visual state**, **gesture lifecycle** を同じ key と callback で接続している点に集中する。

優先度の高い修正順は次の通り。

1. **Runtime safety**: stale scheduler callback、async timeline rebuild、audio init/load failure を generation / error boundary で止める。
2. **Gesture contract**: `mousedown` ではなく、range preview start / commit / cancel を semantic event として親へ渡す。
3. **Identity contract**: `ColumnKey`, `NoteIdentity`, `staffScope` を型として分離し、source identity と layout identity を混同しない。
4. **Visual contract**: click / MIDI / playback / range の表示責務を統合し、notehead 色付けを `NoteVisualState` resolver に寄せる。
5. **Module boundary**: `useScorePlayback`, `useScoreModel`, `useScoreRangeSelection` へ分割し、`App` と `ScoreDisplay` の肥大化を止める。

### Source Of Truth Review

2026-05-24 06:36 UTC に、正本と派生状態の混線を軸に再レビューした。結論は、`PlaybackSession` など一部の正本はあるが、表示用 key、layout identity、audio 実体 state、DOM mutation が別の正本として振る舞っている点が主なリスクである。

Status as of 2026-05-24 06:45 UTC: `NoteDetail` / `PlaybackNoteEvent` へ `noteIdentity` を追加し、playback notehead highlight は `noteIdentity` で照合するよう変更済み。notehead 色は `NoteVisualState` resolver と DOM adapter に分離済み。range は `staffScope` を持つ `ScoreRangeDraft` / `ScoreRangeSelection` に寄せ、playback filter は staff lane id を使う。playback session scheduler は timeline generation を保持し、generation mismatch で停止する。score BPM は score data ごとに一度だけ default として適用する。Playwright 回帰確認 script `npm run test:playback` を追加済み。未対応は source score identity / layout projection の完全分離、`useScorePlayback` / `useScoreModel` への module split。

#### Desired Ownership

- **Source score identity**: MusicXML / OSMD source の measure, staff, voice, source note, absolute tick を正本にする。`systemId`, DOM, notehead index, x/y は render ごとの派生値にする。
- **Playback transport**: `PlaybackSession` を transport 正本にする。再生中は `timelineId` 付き immutable timeline snapshot を参照し、`playbackTimelineRef.current` の差し替えを scheduler に直接反映しない。
- **Logical active events**: score 上で「発音対象として処理中」の正本は `PlaybackSession.activeEvents` にする。ただし actual audio sounding は audio hook 側の synth state と分離し、必要なら `playPlaybackNoteOn()` の受理結果で同期する。
- **Visual note state**: `activeNotes`, `PlaybackSession.activeEvents`, click preview, black-key hint から `NoteVisualState` を純粋に解決する。OSMD DOM mutation は resolver の出力を反映する adapter に閉じる。
- **Range selection**: drag 中は `ScoreRangeDraft`、確定後は `CommittedScoreRange` を正本にする。staff 範囲は layout measure key ではなく stable staff lane identity として保持する。
- **Overlay projection**: range background は正本ではなく、current `MeasureContext` からの projection とする。projection が空になった場合は range session を止めるか、stable identity から再投影する。
- **BPM**: score BPM は score metadata default、user BPM は override として分ける。timeline rebuild が user override を上書きしない。

#### Additional Findings

1. **P1: `PlaybackSession.scheduler` と `playbackTimelineRef.current` が別々の正本になっている**
   - **Evidence**: `src/App.tsx` の `runPlaybackStep()` と `handlePlaybackTimelineReady()`。
   - **Problem**: scheduler は `nextEventIndex`, `rangeEndTick`, `allowedEventIds` を保持するが、timeline は session と独立に差し替えられる。
   - **Failure mode**: 再生中の resize / transpose / score reload で、旧 timeline 用 scheduler index が新 timeline に適用され、skip、重複発音、range 終端ずれが起きる。
   - **Fix direction**: session に `timelineId` / `timelineGeneration` を持たせる。再生中は immutable timeline snapshot を使い、timeline 差し替え時は stop/pause または scheduler 再構築を行う。
   - **Status**: Partially implemented. `timelineGeneration` を持たせ、generation mismatch では停止する。immutable snapshot 化は未対応。

2. **P1: `PlaybackSession.activeEvents` と audio hook の `playbackNotesRef` が二つの「発音中」を持っている**
   - **Evidence**: `src/App.tsx` の `processPlaybackEvent()`、`src/hooks/usePianoSound.ts` の `playbackNotesRef`。
   - **Problem**: App は audio note-on の成功前に `activeEvents` を更新し、audio hook は別に actual note-off 用 state を持つ。
   - **Failure mode**: audio init 遅延、失敗、`shouldPlay` false により、画面は green だが実音が鳴っていない状態になる。
   - **Fix direction**: `playPlaybackNoteOn()` が受理結果を返し、それを session に反映する。少なくとも `activeEvents` を logical playback state と明名化し、actual sounding state と混同しない。
   - **Status**: Partially implemented. `playPlaybackNoteOn()` は boolean を返し、受理後に `activeEvents` へ反映する。actual audio phase の明示型は未対応。

3. **P1: Notehead highlight key が source note identity を潰している**
   - **Evidence**: `src/App.tsx` の `getPlaybackEventNoteKey()`、`src/components/ScoreDisplay.tsx` の `getPlaybackNoteKey()`。
   - **Problem**: `systemId:measureNumber:staffId:columnKey:displayMidi` は layout と display pitch の組み合わせであり、voice / source note / rendered notehead を区別しない。
   - **Failure mode**: 同一 staff / column / pitch の複数 voice や unison で、片方だけ再生中でも両方の notehead が緑になる。
   - **Fix direction**: `PlaybackNoteEvent` と `NoteDetail` に共通の `noteIdentity` / `noteheadKey` を追加する。`displayMidi` は identity ではなく pitch projection として扱う。
   - **Status**: Implemented for current extraction path. `noteIdentity` を追加し、highlight key を `noteIdentity` に変更した。

4. **P1: Range staff scope が layout measure key を正本にしている**
   - **Evidence**: `ScoreRangeSelection.selectedStaffKeys`, `getStaffKey()`, range playback filter。
   - **Problem**: `selectedStaffKeys` は `systemId:measureNumber:staffId` で、stable staff lane ではない。
   - **Failure mode**: resize/reflow や複数 system selection で、右手/左手の overlay と playback filter がずれる。
   - **Fix direction**: committed range に `staffScope: 'all' | { staffIds: number[] }` などを持たせる。measure-level overlay key は current layout から派生させる。
   - **Status**: Partially implemented. `staffScope` を追加し、playback filter と overlay projection は staff id を使う。part/staff source identity は未対応。

5. **P1: 「背景が消えたら再生も止める」契約が projection 消失を観測できない**
   - **Evidence**: `activeRange = dragRange ?? playbackRangeSelection`, `rangeSpans`, `handlePlaybackTimelineReady()`。
   - **Problem**: App の正本 `playbackSession.range` が残っていても、ScoreDisplay 側の `contexts` との照合に失敗すると背景だけ消える。
   - **Failure mode**: 背景なしの範囲再生が継続し、ユーザーに見えている状態と transport state が不一致になる。
   - **Fix direction**: committed range projection が空になったら parent へ invalid/cancel event を返す。長期的には stable lane/time identity から再投影する。
   - **Status**: Implemented as stop-on-invalid-projection. Stable lane/time identity からの再投影は未対応。

6. **P1: score tempo と user speed control の正本分離**
   - **Evidence**: `PlaybackTimeline.tempoEvents` と `settings.playbackSpeedMultiplier`。
   - **Problem**: score tempo と user control を同じ setting に統合すると、どちらが正本か分からない。
   - **Failure mode**: 譜面再抽出と user 操作が同じ値を上書きし合い、再生速度の由来が追跡できなくなる。
   - **Fix direction**: score tempo は timeline、user control は速度倍率として分離する。
   - **Status**: Implemented. BPM 直接指定を廃止し、譜面の `tempoEvents` と `settings.playbackSpeedMultiplier` を分離した。

7. **P2: Notehead DOM mutation が visual state の正本を隠している**
   - **Evidence**: `ScoreDisplay` の note color effect。
   - **Problem**: `fill/stroke/style` を直接上書きし、reset は固定 `#000000` で行うため、元 style と visual priority が保存されない。
   - **Failure mode**: OSMD 元色、voice color、符幹/符頭の違いが壊れ、state 更新順で見た目が変わる。
   - **Fix direction**: `NoteVisualState` resolver を先に作る。短期は DOM mutation adapter と WeakMap restore、長期は notehead overlay SVG へ移行する。
   - **Status**: Implemented as resolver + DOM adapter with WeakMap restore. Overlay SVG 化は未対応。

8. **P2: drag draft と committed range が同じ型で混ざっている**
   - **Evidence**: `dragRange`, `playbackRangeSelection`, `activeRange`。
   - **Problem**: preview 用の未検証 range と playback が参照する確定 range が同じ `ScoreRangeSelection` で表現される。
   - **Failure mode**: preview だけの一時状態が committed state のように扱われ、commit 失敗や cancel の意味が追いにくくなる。
   - **Fix direction**: `ScoreRangeDraft` と `CommittedScoreRange` を型で分け、commit は builder/validator を通す。
   - **Status**: Partially implemented. `ScoreRangeDraft` と `ScoreRangeSelection` は分離したが、専用 builder/validator は未対応。

9. **P2: UI regression boundary が正本の不変条件を固定していない**
   - **Evidence**: `package.json` に test script がなく、Playwright 確認は一時 script と手動実行に留まる。
   - **Problem**: drag overlay、発音中 notehead、keyboard highlight、Stop 後 cleanup、timeline generation race が継続的に検証されない。
   - **Failure mode**: 正本整理後も、表示と実音のズレや stale overlay が再発する。
   - **Fix direction**: Playwright test を追加し、drag 中 overlay、mouseup 後 overlay、playback notehead green、keyboard green、Stop 後の green/overlay 消失を assert する。
   - **Status**: Implemented. `tool/playback_regression.cjs` と `npm run test:playback` を追加した。

### Post-fix Subagent Review

2026-05-24 06:52 UTC に、修正後の状態を playback runtime、note visual state、range gesture、source/layout identity、regression tooling の 5 分担で再レビューした。結論は、短期的な runtime guard と visual resolver は改善しているが、source identity と layout projection の型分離、audio readiness contract、committed range invariant、DOM adapter lifecycle、test の正本観測はまだ残っている、というもの。

#### P1 Findings

1. **Audio init が transactional ではない**
   - **Evidence**: `src/hooks/usePianoSound.ts` の `initAudio()`, `startAudio()`, `playPlaybackNoteOn()`。
   - **Problem**: SoundFont load 完了前に `audioContextRef` / `synthRef` が公開され、失敗時も refs が rollback されない。
   - **Failure mode**: SoundFont fetch/load 失敗後に画面は playback active / notehead green になるが、実音が鳴らない。また壊れた partial audio engine を再利用し続ける。
   - **Fix direction**: audio init を transactional にし、SoundFont load 成功後だけ refs を publish する。失敗時は synth/context を close/reset し、`audioState: ready | loading | error` を App の playback boundary へ返す。
   - **Status**: Implemented as safety patch. SoundFont load 成功後だけ refs を publish し、失敗時は unpublished synth/context を close する。SoundFont switch は load promise/generation 経由で待つ。明示的な `audioState` union は未対応。

2. **`visualTranspose` と pitch field が sounding と rendering を混ぜている**
   - **Evidence**: `src/components/ScoreDisplay.tsx` の OSMD render / timeline extraction、`src/utils/osmdCoordinates.ts` の pitch mapping、`src/App.tsx` の audio / keyboard highlight。
   - **Problem**: `visualTranspose` が OSMD render と timeline pitch の両方に入り、同じ pitch field が audio pitch と keyboard highlight に使われる。
   - **Failure mode**: OSMD transpose が `sourceNote.Pitch` に反映される経路では二重 transpose、反映されない経路でも sounding と rendering の責務が同名で混ざる。
   - **Fix direction**: `sourceMidi`, `soundingMidi`, `renderedMidi` を分け、audio は `soundingMidi`、score projection は `renderedMidi` を参照する。
   - **Status**: Implemented as safety patch. `displayMidi` を廃止し、`soundingMidi` / `renderedMidi` を追加した。`visualTranspose` を `extractPlaybackTimeline()` に渡す経路と、ScoreDisplay の `detail.midi + visualTranspose` 経路は削除した。元 MusicXML pitch を transpose 前に保持する source model は未対応。

3. **Timeline が layout identity を正本にしている**
   - **Evidence**: `PlaybackNoteEvent` の `columnKey`, `systemId`, `staffId`、range playback filter。
   - **Problem**: `PlaybackTimeline` が current layout / current projection 由来の identity を保持し、range playback の filter もそれを正本として使う。
   - **Failure mode**: resize/reflow/transpose 後に generation guard で止める短期対策はあるが、source event を layout 変更から独立に扱えない。
   - **Fix direction**: timeline は `sourceMeasureIndex`, source staff lane, source voice, source note index, absolute tick を持つ source event model にする。`systemId`, x/y, DOM, notehead は projection に限定する。

4. **Playback regression test が実行環境を所有していない**
   - **Evidence**: `package.json` の `test:playback`、`tool/playback_regression.cjs` の `APP_URL` default。
   - **Problem**: test は起動済み dev server と一時 `npx -p playwright` に依存する。
   - **Failure mode**: fresh checkout / CI / 別端末では、正本 invariant 以前に server 未起動または browser 未導入で落ちる。
   - **Fix direction**: `@playwright/test` を devDependency に固定し、Playwright config の `webServer` か script 内 server 起動と readiness wait を持たせる。

#### P2 Findings

1. **`noteIdentity` が source identity と rendered notehead identity を混ぜている**
   - **Evidence**: `src/utils/osmdCoordinates.ts` の `buildNoteIdentity()` と timeline event mapping、`src/types/piano.ts` の `noteIdentity`。
   - **Problem**: `measureNumber`, `staffId`, `columnIndex`, `voiceId`, rendered note index, midi の合成で、source note identity と rendered notehead identity が分離していない。
   - **Failure mode**: repeated measure number、同一 source note の複数 render、OSMD/VexFlow の notehead order 変更で、別 notehead が同時に playback active と見なされる。
   - **Fix direction**: `SourceNoteId` と `RenderedNoteheadId` を分ける。`PlaybackNoteEvent` は source id、`NoteDetail` は source id + rendered id を持つ。

2. **`columnKey` が time key と visual column id を混ぜている**
   - **Evidence**: `src/utils/osmdCoordinates.ts` の timestamp/fallback/sentinel 生成、`src/components/ScoreDisplay.tsx` の ordering。
   - **Problem**: absolute timestamp、measure-local fallback、default sentinel が同じ `string` 空間に入る。
   - **Failure mode**: timestamp が取れない譜面で range ordering、timeline filter、hit-test が silent に別基準へ落ち、選択範囲と再生範囲が一致しない。
   - **Fix direction**: `ColumnKey` を discriminated union にするか、`timeTick/timeKey` と `visualColumnId` を別 field に分ける。

3. **`staffScope` が stable staff lane ではない**
   - **Evidence**: `StaffScope` の `staffIds: number[]`、`getSelectedStaffScope()`、range playback filter。
   - **Problem**: source part/staff identity ではなく numeric `staffId` だけで範囲を表す。
   - **Failure mode**: 複数 part、staff id の再利用、source/layout 対応変更で、右手/左手の overlay と playback filter が別譜表へ当たる。
   - **Fix direction**: `StaffLaneId` を source part + staff index で定義し、`MeasureContext` / `PlaybackNoteEvent` / `StaffScope` を同じ lane identity で接続する。

4. **Committed range の invariant が型にも builder にもない**
   - **Evidence**: `ScoreRangeDraft` と `ScoreRangeSelection`、`startRangePlayback()`。
   - **Problem**: draft と committed range が構造的にほぼ同一で、column ordering、endpoint inclusion、空配列禁止、staff scope 正規化が単一入口に固定されていない。
   - **Failure mode**: keyboard shortcut、test fixture、保存済み range など別経路で range を作ると、overlay と playback filter がずれる。
   - **Fix direction**: `createScoreRangeSelection()` / `validateScoreRangeSelection()` を単一入口にし、確定型は branded type か `CommittedScoreRange` にする。

5. **DOM adapter が全復元 lifecycle を持っていない**
   - **Evidence**: `ScoreDisplay` の original style `WeakMap` と notehead mutation effect。
   - **Problem**: `WeakMap` は列挙できないため、OSMD rerender/load/unmount 前に mutate 済み全要素を戻せない。
   - **Failure mode**: resize/render 後に SVG element が再利用された場合や、抽出失敗で旧 notehead が current contexts から外れた場合、前回の red/green/hint 色が残る。
   - **Fix direction**: iterable な mutated element registry を持つ adapter にし、OSMD `render/load` 前、effect cleanup、unmount で `restoreAll()` する。

6. **DOM 対象粒度が VexFlow DOM 順に依存している**
   - **Evidence**: `getNoteHeadElement()` が `.vf-note` 配下の `path, ellipse` を広く集め、`detail.index` で選ぶ。
   - **Problem**: `noteIdentity` と実 DOM element の対応が固定されていない。
   - **Failure mode**: chord、unison、符頭以外の path、VexFlow/OSMD の DOM 構造変更で別 path を着色・復元する。
   - **Fix direction**: extraction 時に GraphicalNote から実 notehead element への対応を adapter 専用 field として保持するか、OSMD DOM 直接 mutation をやめて notehead overlay SVG に寄せる。

7. **Range projection invalidation が部分欠落を検出しない**
   - **Evidence**: `rangeSpans.length > 0` による valid 判定。
   - **Problem**: 複数 system / staff / measure のうち一部だけ投影に失敗したケースを検出できない。
   - **Failure mode**: reflow 後に一部の背景だけ消え、見えていない staff/measure の note が range playback に残る。
   - **Fix direction**: projection 結果に expected coverage を持たせ、選択 column/staff のうち投影できない範囲があれば invalid/cancel にする。

8. **Drag lifecycle が pointer cancel / outside mouseup を所有していない**
   - **Evidence**: ScoreDisplay local mouse events、`suppressNextClickRef`。
   - **Problem**: pointer capture、window-level `pointerup`、`pointercancel`、`blur`、明示的な cancel event がない。synthetic click suppression も gesture id に紐づかない。
   - **Failure mode**: ScoreDisplay 外で mouseup / window blur すると preview overlay や refs が残る。drag 後に次の正当な click が捨てられる可能性もある。
   - **Fix direction**: Pointer Events + `setPointerCapture` へ寄せ、`commitDrag()` / `cancelDrag()` / `resetDragState()` を単一 lifecycle にまとめる。

9. **Test が visual count に寄りすぎて正本 invariant を観測していない**
   - **Evidence**: `tool/playback_regression.cjs` の green SVG count assertion。
   - **Problem**: `PlaybackSession.range/currentColumnKey/activeEvents/scheduler.timelineGeneration` を直接固定していない。
   - **Failure mode**: 別の緑要素、誤った staff overlay、audio 実体と表示 state のズレ、stale scheduler 残留を見逃す。
   - **Fix direction**: test probe か stable test id で、Stop 後 `status=stopped`, `activeEvents=0`, `range=null`, `currentColumnKey=null`、range staff scope、timeline generation mismatch stop を観測する。

#### P3 Findings

- `NoteVisualState` は `{ color }` だけでなく `{ kind, color }` を返し、semantic state と presentation color を分ける。
- gesture で全 staff を選んだ場合は `{ type: 'all' }` に正規化し、明示的な片手選択だけ `{ type: 'staffs' }` にする。
- Playwright locators は visible label / global SVG heuristic ではなく、score container scoped selector と stable `data-testid` へ寄せる。
- console warning/error は既知 noisy log の allowlist を除いて fail condition にする。

#### Confirmed Improvements

- `PlaybackSession` に scheduler、active events、timeline generation がまとまり、停止後 callback 復活と古い timeline の再駆動リスクは下がった。
- `playPlaybackNoteOn()` の boolean 受理後に `activeEvents` を更新する形になり、logical active event と audio command の順序は改善した。
- playback notehead highlight は pitch field ではなく `noteIdentity` 照合になり、同一 pitch/column の notehead がまとめて緑になる問題は狭まった。
- MIDI red、playback green、black-key hint の priority は `NoteVisualState` resolver に集約された。
- `ScoreRangeDraft` と `ScoreRangeSelection`、`staffScope`、stop-on-invalid-projection により、range preview / committed range / playback filter の分離は進んだ。

#### Next Design Step

次の大きな修正単位は、`ColumnKey` / `NoteIdentity` / `staffId` / source pitch identity を型レベルで分離し、`ScoreDisplay` から playback model extraction を外すこと。その後に `useScorePlayback` と audio engine state contract を分離すると、runtime と UI の正本を追いやすくなる。

### Post-fix Follow-up Review

2026-05-24 07:15 UTC に、audio lifecycle、pitch / transpose、playback session、ScoreDisplay visual state、regression boundary の 5 分担で再レビューした。

#### Critical Findings

1. **P1: `sourceMidi` と `renderedMidi` が実質同じ値になっている**
   - **Evidence**: `src/types/piano.ts`, `src/components/ScoreDisplay.tsx`, `src/utils/osmdCoordinates.ts`。
   - **Problem**: 型では pitch を分けたが、timeline 抽出では `sourceMidi = mapped.detail.midi`, `renderedMidi = mapped.detail.midi`, `soundingMidi = renderedMidi` になっている。
   - **Failure mode**: `visualTranspose !== 0` で元 MusicXML pitch を失うか、OSMD が source pitch を変えない経路で rendered pitch が嘘になる。
   - **Fix direction**: transpose 前の source model から `sourceMidi`、現在の描画 projection から `renderedMidi` を取る。短期でも同じ `detail.midi` から両方を埋めない。
   - **Status**: Implemented as safety patch. `extractSourceNoteMidiMap()` で `visualTranspose` 適用前に source pitch を採取し、timeline 抽出へ渡す。`renderedMidi` は current `NoteDetail.midi` から取る。

2. **P1: 回帰テストが notehead highlight の破損を見逃す**
   - **Evidence**: `tool/playback_regression.cjs` の `countGreenScoreElements()`。
   - **Problem**: `svg rect` も数えるため、range overlay の緑 rect が再生中 notehead highlight として数えられる。
   - **Failure mode**: notehead highlight が壊れても、range overlay が残っていれば `maxGreenScore > 0` で pass する。
   - **Fix direction**: score playback highlight は `path, ellipse` の notehead に限定するか、overlay と notehead に stable test id を付けて別々に検証する。
   - **Status**: Implemented. range overlay に `data-testid=\"score-range-overlay\"` を付け、score playback highlight は `path/ellipse[data-midi]` だけを数える。

3. **P1: pitch regression test が期待 MIDI pitch を見ていない**
   - **Evidence**: `tool/playback_regression.cjs`, `src/App.tsx`, `src/components/ScoreDisplay.tsx`。
   - **Problem**: 「任意の keyboard key が緑」「任意の score 要素が緑」だけを検証し、期待 MIDI pitch と `soundingMidi` / actual synth pitch の一致を見ない。
   - **Failure mode**: score notehead は正しいが keyboard/audio が octave ずれる、または transpose 適用が誤る regression が通る。
   - **Fix direction**: keyboard key に `data-midi` を持たせ、期待 active key MIDI を assert する。可能なら fake synth / spy で `midiNoteOn` pitch も検証する。
   - **Status**: Partially implemented. keyboard key に `data-midi` を付け、green notehead MIDI と green keyboard MIDI の一致を assert する。fake synth / actual `midiNoteOn` pitch spy は未対応。

#### Remaining P2 Findings

- **Audio lifecycle**: 未公開の初期化中 engine が unmount / obsolete init で回収されない。SoundFont 切替中の MIDI note-off / sustain が捨てられる。SoundFont switch 失敗時に旧音源は残っているが UI は再生不能状態になる。
- **Pitch contract**: `soundingMidi` は actual synth pitch ではない。`usePianoSound` がさらに `settings.transpose` を足すため、keyboard highlight と実音がずれ得る。`noteIdentity` の pitch 依存は短期 patch で外したが、source id と rendered id の型分離は未対応。
- **Playback session**: pause 時に `scheduler.nextEventIndex` を current tick まで正規化していない。note-off 後の `currentColumnKey` が残存 `activeEvents` と整合しない。`startAudio()` await 後に captured timeline / range の鮮度を再検証しない。
- **ScoreDisplay**: component 外 mouseup で drag state が残る。multi-staff range overlay が measure group 全体を span せず staff ごとに分断される。
- **Regression boundary**: SoundFont slow load / loading 中 click を制御するテスト境界がない。console error / warning を収集しても fail condition にしていない。

#### Positive Findings

- `startPlayback()` / `startRangePlayback()` は `startAudio()` を await してから session を作るため、audio readiness の production boundary は改善した。
- `playPlaybackNoteOn()` は readiness 再確認と `shouldPlay` token を持ち、stale note-on を抑える方向になっている。
- `PlaybackSession` に `status`, `range`, `currentColumnKey`, `activeEvents`, `scheduler` がまとまり、停止後 callback と古い timeline 再駆動のリスクは下がっている。
- `NoteDetail.midi` が rendered score pitch と明記され、notehead coloring / selection / guide line の pitch contract は以前より揃った。

#### Next Fix Order

1. `soundingMidi` の命名または actual synth pitch 導出の整理。
2. audio init unmount cleanup と SoundFont switch failure policy。
3. pause cursor / `currentColumnKey` 再導出 / start request freshness check。
4. source id と rendered notehead id の型分離。
5. SoundFont slow load / actual synth pitch spy の regression boundary 追加。

### Consolidated Findings

#### P1: Runtime が停止後に再駆動され得る

- **Evidence**: `src/App.tsx` の `runPlaybackStep`, `clearPlaybackTimer`, `stopPlayback`。
- **Problem**: `clearInterval` は行うが、`runPlaybackStep()` 自体に `session.status === 'playing'` や session generation の入口 guard がない。
- **Failure mode**: Stop / Pause 直後に遅れて走った callback が stopped session の scheduler 初期値から tick 0 event を処理し、先頭 note、cursor、activeEvents が復活する。
- **Fix direction**: `runPlaybackStep(expectedSessionId, expectedToken)` とし、入口で playing status と generation 一致を検査する。stopped session の scheduler 値に安全性を依存させない。

#### P1: Timeline rebuild に generation cancellation がない

- **Evidence**: `src/components/ScoreDisplay.tsx` の async OSMD load/render/timeline extraction、`src/App.tsx` の `handlePlaybackTimelineReady`。
- **Problem**: score data / `visualTranspose` の世代を持たず、古い async result が後勝ちで `playbackTimelineRef.current` へ採用される。
- **Failure mode**: score 切替や transpose 変更を素早く行うと、表示中 score と再生 timeline / pitch / highlight がずれる。変更中に旧 timeline の再生が継続する時間も残る。
- **Fix direction**: score input ごとの generation id を発行し、ScoreDisplay と App の両側で最新 generation だけ採用する。score / transpose 変更時は timeline 完成前に playback を即 invalidate / stop する。

#### P1: Range gesture callback が semantic event ではない

- **Evidence**: `src/components/ScoreDisplay.tsx` の `handleMouseDown` は `onRangeSelectionStart` を常に呼ぶ。`src/App.tsx` の `handleRangeSelectionStart` はこれを playback stop として扱う。
- **Problem**: callback 名は range gesture 開始に見えるが、実体は低レベル `mousedown` である。
- **Failure mode**: 範囲再生中に単純 click しただけで range playback / overlay が消える。一方で full playback 中の drag preview では既存 playback が鳴り続け得る。
- **Fix direction**: `pointerdown` と domain event を分ける。drag threshold を超えて range preview が実際に始まった時点で `onRangePreviewStart`、確定で `onRangeSelectionComplete`、中断で `onRangeSelectionCancel` を出す。

#### P1: Range model が staff lane ではなく画面矩形になっている

- **Evidence**: `src/components/ScoreDisplay.tsx` の `getSelectedStaffKeys()`, `src/types/piano.ts` の `ScoreRangeSelection.selectedStaffKeys`。
- **Problem**: 二次元 range が「時間範囲 + staff lane」ではなく、「start/end の画面 y 矩形に入った `systemId:measureNumber:staffId` 群」として表現される。
- **Failure mode**: 複数 system をまたぐ右手のみ / 左手のみ選択で、中間 system や反対譜表が混入する。長い範囲ほど画面矩形と楽譜上の lane が乖離する。
- **Fix direction**: `ScoreRangeSelection` は `columnKeys` と stable staff lane identity (`staffIds`, part-staff identity, `staffScope`) を持つ。measure ごとの overlay key は ScoreDisplay が current contexts から派生する。

#### P1: Timeline が layout identity を保持している

- **Evidence**: `extractPlaybackTimeline()` は `MeasureContext` 由来の `systemId`, `staffId`, `columnKey` を `PlaybackNoteEvent` に持たせる。
- **Problem**: `systemId` は page/system の描画順であり layout identity である。resize 時に `contexts` だけ再抽出されると timeline と current layout がずれる。
- **Failure mode**: resize / reflow 後に range filter が外れる、発音中 notehead が緑にならない、`No playable notes` が出る。
- **Fix direction**: timeline は source identity (`sourceMeasureIndex`, source staff, voice, source note, absolute tick) を持つ。表示側で current `MeasureContext` へ projection する。暫定なら contexts 再抽出ごとに timeline も再抽出する。

#### P1: `columnKey` が複数概念を同じ string 空間に混ぜている

- **Evidence**: `getColumnKeyFromTimestamp()` は timestamp key、fallback visual key、default sentinel を同じ `columnKey` として返す。`ScoreDisplay` は timestamp 形式だけ parse して ordering する。
- **Problem**: `columnKey` が absolute timestamp、measure-local fallback column、default sentinel を同時に表す。
- **Failure mode**: timestamp が取れない column が混ざると range ordering が visual fallback に依存し、timeline event と range selection の照合が silent に外れる。
- **Fix direction**: `ColumnKey` を discriminated union にするか、canonical `timeKey` / `tick` と `visualColumnId` を別 field にする。range / playback filter は canonical time、hit-test / overlay は visual id を使う。

#### P1: Notehead identity が playback 表示 key で潰れている

- **Evidence**: `PlaybackNoteEvent.id` の base には voice / note index が入るが、`playbackActiveNoteKeys` は `systemId:measureNumber:staffId:columnKey:displayMidi` へ投影される。
- **Problem**: `NoteDetail` に stable source note / voice / notehead identity がなく、最後は `detail.index` と SVG DOM の `heads[index]` 対応に依存する。
- **Failure mode**: 同一 staff / column / pitch に複数 voice や unison notehead があると、片方だけ発音中でも両方が緑になる。OSMD/VexFlow の DOM 順がずれた場合も誤着色する。
- **Fix direction**: `NoteIdentity` / `noteheadKey` を定義し、`PlaybackNoteEvent` と `NoteDetail` の共通 contract にする。synth pitch identity とは分離する。

#### P2: `ScoreRangeSelection` の invariant が型にも builder にもない

- **Evidence**: `ScoreRangeSelection` は public type だが、`columnKeys` の順序、endpoint 包含、`selectedStaffKeys` の空配列意味を型が固定しない。
- **Problem**: App と ScoreDisplay が未検証の range object を信頼している。空 `selectedStaffKeys` は実装上「全 staff」だが仕様上は選択 staff measure 群である。
- **Failure mode**: keyboard shortcut、test fixture、保存済み range など別経路で range を作ると、全譜表再生や overlay / playback の不一致が起きる。
- **Fix direction**: `createScoreRangeSelection()` / `validateScoreRangeSelection()` を単一 builder とし、endpoint 包含、表示順、`staffScope: 'all' | 'selected'` を固定する。drag draft と committed range を型で分ける。

#### P2: Drag cleanup が local `mouseup` に依存している

- **Evidence**: ScoreDisplay の drag refs と `dragRange` は component 内 `onMouseUp` で cleanup される。pointer capture、document-level `mouseup`, `pointercancel`, window blur がない。
- **Problem**: gesture lifecycle の cancel path が不足している。
- **Failure mode**: ScoreDisplay 外で mouseup すると preview overlay や refs が残り、次の click / drag と stale state が混ざる。
- **Fix direction**: Pointer Events と `setPointerCapture` へ寄せるか、drag 中だけ window に `pointerup` / `pointercancel` / `blur` listener を張る。cleanup は単一 `cancelDrag()` に集約する。

#### P2: `selection` prop の contract が死んでいる

- **Evidence**: `ScoreDisplayProps.selection` は存在し App から渡されるが、ScoreDisplay では destructure されず、`displaySelection = playbackSelection` で固定される。
- **Problem**: click selection と playback selection の ownership が props contract 上で未整理である。
- **Failure mode**: caller は `selection` が表示に効くと考えるが、実装は playback 表示だけを正にする。click preview、range preview、playback cursor の緑表示 contract が揺れる。
- **Fix direction**: click selection を表示しないなら `selection` prop と App 側渡しを削除する。表示するなら `selectionHighlight`, `playbackHighlight`, `rangeOverlay` のように目的別 props へ分ける。

#### P2: `currentColumnKey` が cursor と black-key hint 抑制を兼ねている

- **Evidence**: `currentColumnKey` は `playbackSelection/displaySelection` に変換され、実質的に black-key hint 抑制条件として使われる。
- **Problem**: 仕様上 `currentColumnKey` は cursor 用、発音中 notehead は `activeEvents` 用だが、実装は cursor 専用 render path を持たない。
- **Failure mode**: 長い note と短い note が重なると、最後の note-on column が black-key hint 抑制だけを起こし、発音中 notehead 群とは違う visual state になる。
- **Fix direction**: `playbackColumnKey` は cursor / column overlay 専用の render path にする。black-key hint 抑制は `playbackActiveNoteKeys` または `NoteVisualState` resolver で決める。

#### P2: Notehead 色付けが DOM mutation と固定黒リセットに依存している

- **Evidence**: ScoreDisplay の effect が OSMD/VexFlow の SVG DOM を直接 mutate し、reset は常に `#000000` に戻す。
- **Problem**: React state から declarative に描画されず、OSMD の元 style、print color、voice color、符幹 / accidental の区別が保存されない。
- **Failure mode**: OSMD の SVG 構造変更や複雑な譜面で意図しない要素が赤/緑/黒に固定される。表示優先順位が局所 if 文に埋まる。
- **Fix direction**: DOM mutation は adapter に閉じ込め、先に `NoteVisualState` resolver を作る。可能なら notehead overlay SVG を描画し、OSMD DOM は座標取得だけに使う。

#### P2: Visual contract が文書間で分岐している

- **Evidence**: click-selection spec は click selection の green selected state を前提にし、score-playback spec は click 後の score note 緑保持を禁止する。実装では `selection` prop が死んでいる。
- **Problem**: click / MIDI / playback / range のどれが score notehead を緑にできるかが一つの contract になっていない。
- **Failure mode**: playback 修正時に click behavior を壊す、または click 修正時に playback notehead と競合する。
- **Fix direction**: visual contract を一文書へ統合し、`NoteVisualState` の priority table として固定する。

#### P2: Audio readiness が scheduler contract と分離していない

- **Evidence**: SoundFont 切替中は `isSamplesLoaded=false` になるが、既存 playback timer は止まらない。`playPlaybackNoteOn()` は load generation を見ない。
- **Problem**: UI は `canPlayback=false` で Play/Pause を disabled にする一方、runtime は playing のまま tick と events を進める。
- **Failure mode**: SoundFont 切替中に無音 note、旧音源 note、途中で音色が変わる note、Pause できない playing state が出る。
- **Fix direction**: audio engine state を `idle | initializing | ready | loading-soundfont | error` などとして公開する。playback 中の SoundFont 変更は stop/pause するか、readiness 回復まで scheduler を進めない。
- **Status**: Partially implemented. SoundFont load promise / generation を持たせ、`startAudio()` と `playPlaybackNoteOn()` が current SoundFont readiness を待つ。明示的な audio state union と scheduler freeze policy は未対応。

#### P2: Audio 初期化失敗が playback error boundary に入らない

- **Evidence**: `startPlayback()` / `startRangePlayback()` は `await startAudio()` を `try/catch` しない。`usePianoSound` は失敗を throw する。
- **Problem**: `playbackError` は timeline / range error だけを扱い、audio init/load failure を扱わない。
- **Failure mode**: Worklet/SoundFont fetch 失敗時に rejected promise で終わり、ユーザーに原因が表示されない。同じ失敗を繰り返せる。
- **Fix direction**: audio error を App の playback error boundary に接続し、audio error 中は Play を disabled にする。timeline failure、range validation error、audio readiness error を別 status にする。
- **Status**: Implemented for start paths. `startPlayback()` / `startRangePlayback()` は audio init failure を `playbackErrorKind: 'audio'` に接続する。より詳細な error reason 表示は未対応。

#### P2: Playback state machine が App に残りすぎている

- **Evidence**: `PlaybackSession`, scheduler, timer refs, range filtering, audio note-on/off command が `src/App.tsx` にある。
- **Problem**: root component が UI composition と playback state machine を同時に所有している。
- **Failure mode**: seek、repeat、tempo change、range validation、test 追加時に React render lifecycle と transport lifecycle の両方を App で追う必要がある。
- **Fix direction**: `useScorePlayback` へ reducer、scheduler lifecycle、timeline/range command を移す。App は command と view state を配線するだけにする。

#### P2: ScoreDisplay が複数責務を持ちすぎている

- **Evidence**: `ScoreDisplay` が OSMD lifecycle、timeline extraction、title extraction、loading callback、hit-test、range gesture、range overlay、SVG mutation を持つ。
- **Problem**: rendering 変更が playback timeline の contract に波及する。
- **Failure mode**: async `osmd.load()` 完了順、`visualTranspose` 変更、resize 後 context 更新が playback と表示の整合を暗黙に要求する。
- **Fix direction**: `useScoreModel(data, visualTranspose)` に OSMD load / model extraction を分け、ScoreDisplay は contexts と overlay props を描画する view に寄せる。timeline ready callback には generation を含める。

#### P3: ControlPanel が複数 domain を集約しすぎている

- **Evidence**: `ControlPanel` が score library、audio engine、MIDI、SoundFont、settings、transport を単一 props contract に集約し、`PianoSettings` 全体の shadow state を持つ。
- **Problem**: UI panel が複数 domain の raw settings writer になっている。
- **Failure mode**: settings 保存方式、playback-only BPM、audio-only transpose を分けると、`updateSetting` がどの invariant を通るべきか不明になる。
- **Fix direction**: `ScoreLibrarySelect`, `TransportControls`, `AudioSettingsPopover` に分ける。slider smooth state は `useCommittedSlider` などに閉じる。

#### P3: Regression boundary が不足している

- **Evidence**: 実装テストは確認できない。レビューは read-only で実行検証なし。
- **Problem**: playback reducer、range selection contract、ScoreDisplay props contract が手動確認に依存している。
- **Failure mode**: UI 操作の組み合わせで regression が再発しやすい。
- **Fix direction**: 少なくとも stale scheduler, timeline generation, cross-system drag, mouseup outside, range playback 中 click, full playback 中 drag, SoundFont 切替中 playback を手動シナリオまたは Playwright で固定する。

### Remediation Roadmap

Status as of 2026-05-24 06:45 UTC: safety patch のうち session guard、timeline generation guard、audio init error boundary、SoundFont 読み込み開始時の playback stop、進行中 audio init promise の待機、settings update の no-op guard は実装済み。range contract patch のうち `onRangeSelectionStart` を `onRangePreviewStart` に寄せ、単純 `mousedown` では親へ停止 event を出さず、drag threshold 後に同一 column でも preview overlay を表示する修正は実装済み。`staffScope`, `noteIdentity`, `NoteVisualState`, stop-on-invalid-range-projection, playback regression script は実装済み。pointer cancel、source/layout model 分離、module split は未対応。

1. **Safety patch**
   - `runPlaybackStep` に session generation guard。Implemented.
   - ScoreDisplay の async load/render/timeline extraction に generation guard。Implemented.
   - `startAudio()` failure を `playbackError` に接続。Implemented.
   - SoundFont 切替中の playback policy を stop/pause のどちらかに固定。Implemented as stop.
   - Audio / SoundFont 初期化中に別経路の `startAudio()` が準備済み扱いで返らないよう、進行中 promise を待つ。Implemented.
   - `updateSetting()` は同値更新を no-op にし、callback identity を安定させる。Implemented.

2. **Range contract patch**
   - `onRangeSelectionStart` を廃止または rename し、`onRangePreviewStart`, `onRangeSelectionComplete`, `onRangeSelectionCancel` へ分割。Partially implemented: `onRangePreviewStart` と `onRangeSelectionComplete` まで。
   - drag preview は column 変化ではなく pointer の drag threshold で始め、同一 column でも overlay を表示する。Implemented.
   - pointer capture または window-level cancel cleanup を追加。
   - `ScoreRangeSelection` に `staffScope` を追加し、builder で正規化。

3. **Identity patch**
   - `ColumnKey` を `timeKey` と `visualColumnId` に分ける。
   - `NoteIdentity` / `noteheadKey` を `NoteDetail` と `PlaybackNoteEvent` に追加。
   - timeline は source identity を正とし、layout identity は projection に限定する。

4. **Visual patch**
   - `selection` prop を削除または明示的な click highlight として復活。
   - `NoteVisualState` resolver と priority table を作る。
   - DOM mutation を adapter に閉じ込めるか、overlay SVG へ移行する。

5. **Module split**
   - `useScorePlayback`
   - `useScoreModel`
   - `useScoreRangeSelection`
   - `TransportControls` / `ScoreLibrarySelect` / `AudioSettingsPopover`

## Detail

### Review Sources

レビューは次の担当でサブエージェントに read-only で依頼した。

- **Range selection / overlay / range playback**: gesture lifecycle, range model, cleanup, range invariant。
- **Note coloring / visual state / notehead identity**: identity, DOM mutation, visual priority, click/MIDI/playback/range contract。
- **Playback runtime / session / scheduler / audio lifecycle**: session generation, async cancellation, audio readiness, error boundary。
- **Timeline extraction / timestamp model / score coordinate model**: key space, layout identity, source identity, timeline/visual separation。
- **React component boundaries / state ownership / UI control flow**: `App`, `ScoreDisplay`, `ControlPanel`, hooks, props contract。
- **Source of truth follow-up review**: playback/audio/session, score note visual state, range/overlay/staff scope, timeline/coordinate identity, UI regression boundary。

### Important Internal References

- `src/App.tsx`: playback session, scheduler, range playback command, keyboard highlight projection。
- `src/components/ScoreDisplay.tsx`: OSMD rendering, timeline extraction callback, hit-test, drag range, range overlay, notehead DOM mutation。
- `src/utils/osmdCoordinates.ts`: `MeasureContext`, `NoteDetail`, timeline extraction, timestamp / column key generation。
- `src/types/piano.ts`: public score, range, playback timeline types。
- `src/hooks/usePianoSound.ts`: audio readiness, SoundFont load, playback note-on/off。
- `src/components/ControlPanel.tsx`: transport controls, playback error display, settings shadow state。
- `document/score-playback-spec.md`: current playback/range/visual behavior spec。
- `document/click-selection-spec.md`: older click-selection visual contract。

### Open Decisions

- **Click score highlight**: click preview should either never color score noteheads, or have explicit transient visual state. Current `selection` prop ambiguity should not remain.
- **Range failure policy**: range commit with no playable notes currently stops playback. This should be accepted as contract or changed to range-local feedback while preserving existing playback.
- **SoundFont change policy during playback**: stop, pause, or freeze scheduler. Current behavior is not a defined contract.
- **Layout identity tolerance**: short-term fix can re-extract timeline on layout changes, but long-term design should separate source timeline from layout projection.

## References
