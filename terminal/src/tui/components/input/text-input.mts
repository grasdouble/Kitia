'use strict';

import { renderInputField } from './input-field.mjs';

export interface TextInputProps {
  value: string;
  width: number;
  focused: boolean;
  compact: boolean;
  side?: 'top' | 'middle' | 'bottom';
  focusedColor: string;
  unfocusedColor: string;
  labelColor: string;
}

// TextInput: one input-field row; focus switches its border color.
export function TextInput({
  value,
  width,
  focused,
  compact,
  side,
  focusedColor,
  unfocusedColor,
  labelColor,
}: TextInputProps) {
  return renderInputField({
    value,
    width,
    side,
    compact,
    color: focused ? focusedColor : unfocusedColor,
    labelColor,
  });
}
