import { useEffect, useRef } from 'react';
import type { FC } from 'react';
import {
  Animated,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import type { SvgProps } from 'react-native-svg';

import FrequencyLogoGradient from '@/assets/logo/frequency-logo.svg';
import FrequencyLogoMonochrome from '@/assets/logo/frequency-logo-monochrome.svg';
import FrequencyLogoWhite from '@/assets/logo/frequency-logo-white.svg';
import { FrequencyColors as C } from '@/constants/frequencyTheme';

export type FrequencyLogoColorMode = 'gradient' | 'white' | 'monochrome';

type FrequencyLogoProps = {
  size?: number;
  colorMode?: FrequencyLogoColorMode;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
};

const logoByMode: Record<FrequencyLogoColorMode, FC<SvgProps>> = {
  gradient: FrequencyLogoGradient,
  white: FrequencyLogoWhite,
  monochrome: FrequencyLogoMonochrome,
};

export function FrequencyLogo({
  size = 40,
  colorMode = 'gradient',
  opacity = 1,
  style,
}: FrequencyLogoProps) {
  const Logo = logoByMode[colorMode];

  return (
    <View
      pointerEvents="none"
      style={[
        styles.logoFrame,
        {
          width: size,
          height: size,
          opacity,
        },
        style,
      ]}
    >
      <Logo width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />
    </View>
  );
}

type FrequencyBrandProps = {
  logoSize?: number;
  colorMode?: FrequencyLogoColorMode;
  opacity?: number;
  textStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
};

export function FrequencyBrand({
  logoSize = 30,
  colorMode = 'gradient',
  opacity = 1,
  textStyle,
  style,
}: FrequencyBrandProps) {
  return (
    <View style={[styles.brandRow, style]}>
      <FrequencyLogo size={logoSize} colorMode={colorMode} opacity={opacity} />
      <Text style={[styles.brandText, textStyle]}>Frequency</Text>
    </View>
  );
}

type FrequencyLogoLoaderProps = {
  size?: number;
  colorMode?: FrequencyLogoColorMode;
  label?: string;
  labelStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
};

export function FrequencyLogoLoader({
  size = 54,
  colorMode = 'gradient',
  label,
  labelStyle,
  style,
}: FrequencyLogoLoaderProps) {
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1250,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1250,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [breath]);

  return (
    <View style={[styles.loader, style]}>
      <Animated.View
        style={{
          opacity: breath.interpolate({
            inputRange: [0, 1],
            outputRange: [0.62, 1],
          }),
          transform: [
            {
              scale: breath.interpolate({
                inputRange: [0, 1],
                outputRange: [0.985, 1.025],
              }),
            },
          ],
        }}
      >
        <FrequencyLogo size={size} colorMode={colorMode} />
      </Animated.View>
      {!!label && <Text style={[styles.loaderLabel, labelStyle]}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  logoFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  brandText: {
    color: C.accent,
    fontSize: 18,
    fontWeight: '800',
  },

  loader: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  loaderLabel: {
    color: C.muted,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 14,
    textAlign: 'center',
  },
});
