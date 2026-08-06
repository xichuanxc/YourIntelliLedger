import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field and announced with it. */
  error?: string | null;
  hint?: string;
  containerStyle?: ViewStyle;
}

export function TextField({ label, error, hint, containerStyle, ...inputProps }: TextFieldProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, containerStyle]}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        // The error travels with the field, so a screen reader user hears why
        // the value was rejected rather than just that something is wrong.
        accessibilityHint={error ?? hint}
        placeholderTextColor={theme.textSecondary}
        {...inputProps}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
          },
        ]}
      />
      {(error || hint) && (
        <ThemedText type="small" themeColor={error ? 'danger' : 'textSecondary'} style={styles.help}>
          {error ?? hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  label: { marginLeft: Spacing.half },
  input: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  help: { marginLeft: Spacing.half },
});
