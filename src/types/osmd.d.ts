import 'opensheetmusicdisplay';

declare module 'opensheetmusicdisplay' {
  interface GraphicalMusicSheet {
    UnitInPixels: number;
  }

  interface StaffLinkedExpression {
      octaveShiftStart?: OctaveShift;
      octaveShiftEnd?: OctaveShift;
  }
  
  interface OctaveShift {
      octaveValue: number;
  }

  interface SourceMeasure {
      StaffLinkedExpressions?: StaffLinkedExpression[][];
  }
}