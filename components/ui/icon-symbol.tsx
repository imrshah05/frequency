// Fallback for using Material icon sets on Android and web.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type MaterialIconEntry = { set: 'material'; name: ComponentProps<typeof MaterialIcons>['name'] };
type MaterialCommunityIconEntry = {
  set: 'material-community';
  name: ComponentProps<typeof MaterialCommunityIcons>['name'];
};
type IconEntry = MaterialIconEntry | MaterialCommunityIconEntry;

type IconMapping = Record<SymbolViewProps['name'], IconEntry>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material icon mappings here.
 * - see Material Icons/Community Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': { set: 'material', name: 'home' },
  'magnifyingglass': { set: 'material', name: 'search' },
  'plus.circle.fill': { set: 'material', name: 'add-circle' },
  'bubble.left.fill': { set: 'material', name: 'chat-bubble' },
  'person.crop.circle.fill': { set: 'material', name: 'account-circle' },
  // MaterialIcons has no standalone brain glyph (only the head-profile
  // composite `psychology`), so this one comes from MaterialCommunityIcons.
  'brain': { set: 'material-community', name: 'brain' },
  'paperplane.fill': { set: 'material', name: 'send' },
  'chevron.left.forwardslash.chevron.right': { set: 'material', name: 'code' },
  'chevron.right': { set: 'material', name: 'chevron-right' },
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to a Material icon.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  const entry = MAPPING[name];

  if (entry.set === 'material-community') {
    return <MaterialCommunityIcons color={color} size={size} name={entry.name} style={style} />;
  }

  return <MaterialIcons color={color} size={size} name={entry.name} style={style} />;
}
