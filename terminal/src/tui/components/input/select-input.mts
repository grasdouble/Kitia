'use strict';

import { renderInputField } from './input-field.mjs';

export interface SelectInputProps {
  value: string;
  width: number;
  focused: boolean;
  compact: boolean;
  side?: 'top' | 'middle' | 'bottom';
  focusedColor: string;
  unfocusedColor: string;
  labelColor: string;
}

// SelectInput: one input-field row; focus switches its border color.
export function SelectInput({
  value,
  width,
  focused,
  compact,
  side,
  focusedColor,
  unfocusedColor,
  labelColor,
}: SelectInputProps) {
  return renderInputField({
    value,
    width,
    side,
    compact,
    color: focused ? focusedColor : unfocusedColor,
    labelColor,
  });
}
