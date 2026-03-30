declare module 'cliui' {
  type Alignment = 'left' | 'center' | 'right';

  type Column = {
    text: string;
    width?: number;
    padding?: [number, number, number, number];
    align?: Alignment;
    border?: boolean;
  };

  type UI = {
    div: (...args: Array<string | Column>) => void;
    span: (...args: Array<string | Column>) => void;
    resetOutput: () => void;
    toString: () => string;
  };

  type Options = {
    width?: number;
    wrap?: boolean;
  };

  export default function cliui(options?: Options): UI;
}
