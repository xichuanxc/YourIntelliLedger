/**
 * A static map behind a store address (§4.14).
 *
 * Built out of images rather than a map SDK. The preview does not pan, zoom or
 * respond to gestures — tapping it hands off to the OS maps app, exactly as
 * the Navigate button does — so a native map view would add a dependency and,
 * on Android, a Google Maps API key to deliver a picture. `tiles.ts` works out
 * which squares to fetch; `expo-image` fetches and disk-caches them.
 *
 * The lookup happens here, on mount, which is what §4.14 means by "on demand
 * when the user opens the map view". It is cached per address, so a ledger's
 * regular shops cost one request each, ever.
 *
 * Every failure — offline, address not found, previews switched off — collapses
 * to the same thing: no map, and the address and Navigate button carry on
 * working. A preview is never the reason a bill screen is unusable.
 */

import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { geocode, type GeoPoint } from '@/maps/geocode';
import { readCache, writeCache } from '@/maps/geocodeCache';
import { tileGrid, tileUrl, TILE_SIZE } from '@/maps/tiles';
import { MapPinIcon } from '@/ui/components/map-icons';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

/**
 * OpenStreetMap's own tile servers. Free and keyless, which is the point, but
 * their policy discourages heavy use by distributed apps — a released build
 * should swap this one constant for a hosted provider. The `{s}`-style
 * subdomains are deliberately not used; OSM asks clients not to.
 */
const TILE_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** OSM asks for an identifying User-Agent on tile requests too. */
const TILE_HEADERS = { 'User-Agent': 'YourIntelliLedger/0.1 (COMPX576 student project)' };

const PREVIEW_HEIGHT = 132;

/** The pin's point sits at 21/24 down its own box; this lands it on the centre. */
const PIN_SIZE = 30;
const PIN_TIP_RATIO = 21 / 24;

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; point: GeoPoint }
  | { kind: 'unavailable' };

export interface MapPreviewProps {
  address: string;
  /** Measured by the parent — tiles need a pixel width before they can be laid out. */
  width: number;
  onPress: () => void;
}

/**
 * The cache is synchronous, so a known address is resolved during render —
 * going through an effect would flash a spinner for a coordinate already in
 * hand, once per bill opened.
 */
function fromCache(address: string): State {
  const cached = readCache(address);
  if (cached.kind === 'hit') return { kind: 'ready', point: cached.point };
  if (cached.kind === 'miss') return { kind: 'unavailable' };
  return { kind: 'loading' };
}

export function MapPreview({ address, width, onPress }: MapPreviewProps) {
  const theme = useTheme();
  const [state, setState] = useState<State>(() => fromCache(address));
  const [resolvedFor, setResolvedFor] = useState(address);

  // React's "adjust state during render" pattern, for the case where the same
  // component instance is handed a different bill.
  if (resolvedFor !== address) {
    setResolvedFor(address);
    setState(fromCache(address));
  }

  useEffect(() => {
    if (readCache(address).kind !== 'unknown') return;

    let cancelled = false;

    void (async () => {
      try {
        const point = await geocode(address);
        // A failed *lookup* is not cached — the next open may be online. Only
        // a definitive "no such place" is, which is what `geocode` returning
        // null means.
        writeCache(address, point);
        if (!cancelled) setState(point ? { kind: 'ready', point } : { kind: 'unavailable' });
      } catch {
        if (!cancelled) setState({ kind: 'unavailable' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  if (state.kind === 'unavailable') return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Map showing ${address}`}
      accessibilityHint="Opens the address in your maps app"
      style={({ pressed }) => [
        styles.frame,
        { width, height: PREVIEW_HEIGHT, backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      {state.kind === 'loading' ? (
        <View style={styles.centred}>
          <ActivityIndicator />
        </View>
      ) : (
        <>
          {tileGrid({ lat: state.point.lat, lon: state.point.lon }, width, PREVIEW_HEIGHT).map(
            (tile) => (
              <Image
                key={tile.key}
                source={{ uri: tileUrl(TILE_TEMPLATE, tile), headers: TILE_HEADERS }}
                style={[styles.tile, { left: tile.left, top: tile.top }]}
                // Tiles are immutable for a given z/x/y, so they are worth
                // keeping on disk between launches.
                cachePolicy="disk"
                contentFit="cover"
                transition={150}
              />
            )
          )}

          <View
            pointerEvents="none"
            style={[
              styles.pin,
              {
                left: width / 2 - PIN_SIZE / 2,
                top: PREVIEW_HEIGHT / 2 - PIN_SIZE * PIN_TIP_RATIO,
              },
            ]}>
            <MapPinIcon size={PIN_SIZE} color={theme.danger} filled />
          </View>

          {/* ODbL requires the credit, and OSM asks for it on the map itself. */}
          <ThemedText type="small" style={styles.attribution}>
            © OpenStreetMap
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: Radius.medium, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  pin: { position: 'absolute' },
  attribution: {
    position: 'absolute',
    right: Spacing.one,
    bottom: 0,
    fontSize: 9,
    lineHeight: 14,
    // Tiles are a photograph as far as contrast goes — light here, dark there —
    // so the credit carries its own scrim rather than a theme colour.
    color: '#11181C',
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 3,
    borderRadius: Radius.small,
  },
});
