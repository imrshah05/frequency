import { Image } from 'expo-image';
import { StyleSheet, Text, View, StyleProp, ViewStyle } from 'react-native';

import { FrequencyColors as C } from '@/constants/frequencyTheme';

type AvatarProps = {
  avatarUrl?: string | null;
  initial: string;
  size: number;
  textSize?: number;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
};

export default function Avatar({
  avatarUrl,
  initial,
  size,
  textSize,
  backgroundColor = C.card,
  textColor = C.accentSoft,
  borderColor = C.divider,
  style,
}: AvatarProps) {
  const radius = size / 2;
  const cleanInitial = initial.trim().charAt(0).toUpperCase() || 'F';

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor,
          borderColor,
        },
        style,
      ]}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          contentFit="cover"
          transition={180}
        />
      ) : (
        <Text
          style={[
            styles.initial,
            {
              color: textColor,
              fontSize: textSize ?? Math.round(size * 0.42),
            },
          ]}
        >
          {cleanInitial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },

  initial: {
    fontWeight: '900',
  },
});
