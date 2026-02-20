import gmProgramMapData from './gmProgramMap.json';

interface GmProgramMapItem {
  name: string;
  program: number;
}

interface GmProgramMapCategory {
  category: string;
  instruments: GmProgramMapItem[];
}

export interface GmInstrument {
  program: number;
  name: string;
  category: string;
}

const gmProgramMap = gmProgramMapData as GmProgramMapCategory[];

// Source map URL:
// https://gist.githubusercontent.com/kklemon/d140b116b07ea21690d3404570493dc9/raw/midi-program-change-events.json
// The source map is 1-based (1..128), while FluidSynth program numbers are 0-based (0..127).
export const GM_INSTRUMENTS: GmInstrument[] = gmProgramMap.flatMap((group) =>
  group.instruments.map((instrument) => ({
    category: group.category,
    program: instrument.program - 1,
    name: instrument.name,
  })),
);
