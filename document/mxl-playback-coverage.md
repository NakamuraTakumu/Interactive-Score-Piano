# MXL Playback Coverage

- Created: 2026-05-24 08:19 UTC
- Updated: 2026-05-24 08:24 UTC
- Model: gpt-5.5
- Reasoning-Effort: high
- Session: 019e4058-0985-7fc3-a4ea-c3d5003b4144
- Repository: /home/nakamura/gemini_piano
- Related-Commit: 3f85449fa14ac3e0aac1698b37b5bb51e202b6e3

Responsibility: Created 時点の再生実装が MXL / MusicXML 4.0 の再生関連仕様をどの程度扱うかを整理する。

## Background

現在の再生実装について、MXL / MusicXML 仕様に対する対応範囲を Markdown で残す依頼があった。

## Result

### 結論

現在の実装が扱えるのは、MXL コンテナ内の MusicXML を OSMD が読み込めた後の「表示順の単純な pitched note timeline」に限られる。体感的には、ピアノ向けの素直な楽譜を確認用に鳴らす範囲で、MusicXML 4.0 の再生意味論全体に対しては低いカバー率である。

- **MXL コンテナ**: OSMD へ `.mxl` binary string を渡すだけ。zip / `META-INF/container.xml` / `mimetype` / alternate rootfile の検証や選択はアプリ側ではしない。
- **音高と発音対象**: pitched note の `sourceNote.Pitch` を MIDI 化し、`visualTranspose` 後の描画 pitch を再生 pitch として使う。`unpitched`、percussion、instrument 別 channel は扱わない。
- **時間軸**: OSMD が作った source measure / timestamp / note length から tick を作る。`backup` / `forward` / multiple voice / multiple staff は直接解釈せず、OSMD の正規化結果に依存する。
- **テンポ**: score から抽出できた最初の BPM を UI の初期値にする。再生中の tempo change map は作らない。
- **反復やジャンプ**: MusicXML の repeat、ending、D.C. / D.S. / coda / fine は展開しない。今回追加した Loop はユーザー操作の transport loop であり、MusicXML の repeat 解釈ではない。
- **音符装飾**: MusicXML の note 装飾は `notations` 配下に `articulations`、`ornaments`、`technical`、`dynamics`、`fermata`、`arpeggiate` などとして表れる。現在の再生実装はこれらを timeline に入れず、OSMD が描画した視覚要素として表示されるだけで、発音 timing / duration / velocity / pitch /奏法には反映しない。

### Coverage Map

| 領域 | 現状 | 評価 |
| --- | --- | --- |
| `.mxl` zip container | `.mxl` を `readAsBinaryString()` で読み、OSMD の `load()` に渡す。 | **部分対応**。読み込みは OSMD 任せで、container 仕様の検証はしない。 |
| `score-partwise` / `score-timewise` / opus | アプリ側は分岐しない。OSMD が読めるものだけ表示・再生候補になる。 | **OSMD 依存**。 |
| pitched `<note>` | `sourceNote.Pitch.getHalfTone() + 12` から MIDI を作る。 | **部分対応**。音名・臨時記号は OSMD の pitch 解釈に依存する。 |
| `<rest>` | `sourceNote.isRest()` を skipped note にする。 | **部分対応**。休符は発音しないが、休符 duration 自体は OSMD timestamp / measure duration 経由でのみ反映される。 |
| `<duration>` / divisions | OSMD の `Length` / `TypeLength` fraction を `PPQ=480` tick に変換する。 | **部分対応**。MusicXML の raw `<duration>` / `<divisions>` を直接読まない。 |
| `<chord>` | 同じ timestamp の複数 note は同時発音になる。 | **部分対応**。`<chord>` 要素自体は直接見ない。 |
| multiple voice / staff | source measure の containers / staff entries / voice entries を走査する。 | **部分対応**。`backup` / `forward` を自前で解釈せず、OSMD の構造に依存する。 |
| multiple part | OSMD の `SourceMeasures` に現れた note は拾う。 | **部分対応**。part ごとの音色、channel、solo / mute はない。 |
| clef / key / octave shift | 表示、hit-test、補助線用に使う。 | **再生では限定的**。音高は OSMD source pitch / rendered pitch に依存する。 |
| transposing instruments `<transpose>` | `sourceMidi` と `renderedMidi` を分け、`visualTranspose` 前 pitch を保存する。 | **不完全**。MusicXML の `<transpose>` を concert pitch 再生として体系的には扱っていない。 |
| initial tempo | OSMD の tempo expression / measure tempo などから最初に見つかる BPM を採用する。 | **部分対応**。 |
| tempo changes | timeline event に tempo を持たない。 | **非対応**。 |
| repeat / ending | 展開しない。 | **非対応**。 |
| D.C. / D.S. / coda / fine | `<sound>` attributes を見ない。 | **非対応**。 |
| tie | tie chain を結合しない。 | **非対応寄り**。同音連結が再アタックされる可能性がある。 |
| grace / cue / hidden note | skip する。 | **明示的に非対象**。 |
| unpitched / percussion | `Pitch` がない note は再生されない。 | **非対応**。 |
| dynamics / velocity | 固定 velocity ratio `0.8` と UI の velocity sensitivity を使う。 | **非対応寄り**。MusicXML dynamics は反映しない。 |
| articulations | `staccato`、`tenuto`、`accent`、`strong-accent` などを読まない。 | **非対応**。duration 短縮、velocity 強調、attack 変化はしない。 |
| ornaments | trill、turn、mordent、tremolo、wavy-line などを読まない。 | **非対応**。補助音、反復音、揺れは生成しない。 |
| technical indications | fingering、pluck、harmonic、bend、hammer-on / pull-off などを読まない。 | **非対応**。ピアノ練習表示としても発音には使わない。 |
| slur / phrase | `slur` を読まない。 | **非対応**。legato 化や note overlap 調整はしない。 |
| fermata / breath / caesura | note / articulation 系の停止・間合いを読まない。 | **非対応**。tick は元の note duration のまま進む。 |
| arpeggiate / non-arpeggiate | 和音の発音順制御を読まない。 | **非対応**。同一 timestamp の chord は同時発音になる。 |
| pedal / sustain | UI の sustain setting と MIDI input sustain はある。 | **MusicXML pedal は非対応**。 |
| swing / pizzicato / play technique | `<sound>` / `<play>` / `<swing>` などを timeline に反映しない。 | **非対応**。 |
| MIDI instrument / sound change | UI の SoundFont / GM program を全体へ適用する。 | **非対応寄り**。MusicXML の instrument 指定は読まない。 |
| lyrics / harmony / chord symbol | 再生対象外。 | **非対応**。 |

### 実装上の根拠

- `src/hooks/useScoreLibrary.ts`: `.mxl` は binary string、`.xml` / `.musicxml` は text として保存する。MXL の container 構造はアプリ側で展開・検証しない。
- `src/components/ScoreDisplay.tsx`: `osmd.load(data)` 後に `extractSourceNoteMidiMap()`、`extractMeasureContexts()`、`extractPlaybackTimeline()` を呼ぶ。`visualTranspose` は OSMD render 前に `osmd.Sheet.Transpose` として適用する。
- `src/utils/osmdCoordinates.ts`: timeline は `SourceMeasures`、`VerticalSourceStaffEntryContainers`、`StaffEntries`、`VoiceEntries`、`Notes` から作る。休符、grace、cue、hidden note は skip する。
- `src/utils/osmdCoordinates.ts`: `sourceNote.Notations`、`sourceNote.Articulations`、`sourceNote.Ornaments` 相当の情報は参照していない。`PlaybackNoteEvent` に装飾、奏法、velocity、発音変形を表す field もない。
- `src/App.tsx`: scheduler は tick 昇順の note-on / note-off を進める。tempo map、repeat 展開、instrument map は持たない。
- `src/hooks/usePianoSound.ts`: 再生は単一 channel / 現在の SoundFont / 現在の GM program に集約される。MusicXML の `midi-instrument` や `sound` 内の playback 指定は使わない。

### 判断

現在の再生機能は、MusicXML を「演奏データ」として網羅的に解釈する実装ではなく、「表示済み譜面から単純な note-on / note-off list を作る」実装である。したがって、対応範囲を数値化するなら、MusicXML playback semantics のうち **直線的な pitched notes / rests / chords / basic voices / initial tempo だけ**を対象にする段階で、反復、テンポ変化、音符装飾、奏法、楽器、percussion、正確な tie 処理を含む実演奏仕様の大半は未対応と見るのが妥当である。

## Detail

### 優先して埋めるなら

1. **timeline extraction の正本化**: OSMD private-ish object を直接なぞるだけでなく、MusicXML duration / divisions / backup / forward / chord / voice / staff を明示した中間表現に落とす。
2. **tempo map**: 初期 BPM だけでなく、tick ごとの tempo event を持つ。
3. **repeat graph**: repeat / ending / D.C. / D.S. / coda / fine を display order とは別の playback order として展開する。
4. **tie merge**: `tie` を発音継続として扱い、`tied` notation と混同しない。
5. **note notation interpreter**: `notations` 配下の `articulations`、`ornaments`、`technical`、`dynamics`、`fermata`、`arpeggiate` を、実装対象にするものと表示のみのものへ分類する。
6. **instrument map**: part / score-instrument / midi-instrument / sound instrument-change を channel / program / soundfont selection へ接続する。
7. **percussion support**: unpitched note と percussion map を MIDI note へ変換する。

## References

- [MusicXML 4.0 Final Community Group Report](https://www.w3.org/2021/06/musicxml40/)
- [MusicXML 4.0 container.xsd](https://www.w3.org/2021/06/musicxml40/listings/container.xsd/)
- [MusicXML 4.0 `<note>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/)
- [MusicXML 4.0 `<duration>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/)
- [MusicXML 4.0 `<backup>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/backup/)
- [MusicXML 4.0 `<forward>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/forward/)
- [MusicXML 4.0 `<repeat>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/repeat/)
- [MusicXML 4.0 `<sound>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/)
- [MusicXML 4.0 `<transpose>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)
- [MusicXML 4.0 `<midi-instrument>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/midi-instrument/)
- [MusicXML 4.0 `<notations>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notations/)
- [MusicXML 4.0 `<articulations>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/articulations/)
- [MusicXML 4.0 `<ornaments>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ornaments/)
- [MusicXML 4.0 `<technical>` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/technical/)
