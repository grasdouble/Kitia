declare module 'spdx-expression-parse' {
  export type SpdxNode = {
    license?: string;
    left?: SpdxNode;
    right?: SpdxNode;
    conjunction?: 'and' | 'or';
    exception?: string;
    plus?: true;
  };

  export default function parseExpression(value: string): SpdxNode;
}
