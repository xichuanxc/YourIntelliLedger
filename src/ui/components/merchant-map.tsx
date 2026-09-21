/**
 * Where a period's money was spent, on a map (§4.14).
 *
 * Built the same way as the bill preview: OpenStreetMap raster tiles laid out
 * as plain images, with no map SDK and no API key. It drags to pan, pinches
 * to zoom and steps through whole zoom levels from a fitted view — no
 * rotation, no tilt, no clustering, so a native map view would still be
 * paying for a great deal this screen never uses.
 *
 * The drag claims the gesture from the Insights `ScrollView` the moment a
 * finger lands, so the page does not scroll while the map is being touched.
 * That is the ordinary bargain for an embedded map — the page still scrolls
 * from anywhere else — and a Recentre button undoes any amount of wandering
 * in one tap. Claiming at touch-down rather than after a few pixels is what
 * stops the native scroll view winning the race near the top and bottom
 * edges, where a drag is always vertical.
 *
 * ## One pin per place
 *
 * Spots merge on where they are, not on what they are called — see `spots.ts`.
 * A shop whose name OCR read two ways is two merchants in the database and one
 * shop in the world, and on a map that drew as two pins on one spot, each
 * showing part of the total. Merging by coordinate fixes that and the mall
 * case together.
 *
 * ## Pins carry the spend, the shop, and the amount
 *
 * A pin's **area** is its share of the mapped spend, the encoding people read
 * proportionally without being taught it. Its **colour** is the chain's own
 * (`merchantBrand`), because a New Zealand shopper knows the yellow one is
 * PAK'nSAVE without a legend. Its **label** is the amount, in compact form, on
 * a chip that keeps it legible over map tiles.
 *
 * Labels were left off the first version on the grounds that they collide.
 * Merging removed most of the collisions, and zoom and pan deal with the rest,
 * so the amount now earns its place — it was the thing people wanted from the
 * map and had to tap to get.
 *
 * Pins stay translucent so one behind another still shows through, and colour
 * never carries identity alone: every pin names its shop and total in an
 * accessibility label, which matters because two of these chains are red and
 * green.
 *
 * ## Addresses resolve progressively
 *
 * `geocode` is rate-limited to roughly one request a second, so eight new
 * shops take eight seconds. Waiting for all of them before drawing anything
 * would make the first visit look broken, so cached addresses appear
 * immediately and the rest arrive as they land. A ledger's regular shops are
 * geocoded once, ever.
 */

import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { formatMoney, formatMoneyCompact } from '@/data/money';
import { fitPoints, panCentre, placePoints, touchDistance, zoomStepsFor } from '@/maps/fit';
import { geocode, type GeoPoint } from '@/maps/geocode';
import { readCache, writeCache } from '@/maps/geocodeCache';
import { layoutLabels } from '@/maps/labels';
import { mergeSpots } from '@/maps/spots';
import {
  DEFAULT_ZOOM,
  OSM_TILE_HEADERS,
  OSM_TILE_TEMPLATE,
  TILE_SIZE,
  tileGrid,
  tileUrl,
  type LonLat,
} from '@/maps/tiles';
import type { MerchantLocation } from '@/types/insights';
import { brandColour } from '@/ui/merchantBrand';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

const MAP_HEIGHT = 200;

/**
 * Pin diameters. The floor is a touch target rather than a design choice —
 * a shop with 2% of the spend still has to be tappable.
 */
const MIN_PIN = 20;
const MAX_PIN = 38;

/**
 * How far the buttons can take the map from the fitted view.
 *
 * The floor is roughly a country in frame; the ceiling is the top of OSM's
 * usable raster zooms, where individual buildings are distinct. Zooming in is
 * what separates two shops in the same suburb, which is the whole reason the
 * buttons exist.
 */
const MIN_MAP_ZOOM = 3;
const MAX_MAP_ZOOM = 18;

/**
 * How far a finger may drift and still count as a tap.
 *
 * Without it the map takes the gesture at the first pixel of movement, and a
 * finger never holds perfectly still — which cancelled the zoom buttons
 * mid-press rather than covering them.
 */
const TAP_SLOP = 3;

/** Far enough either way that pinching back is never a long journey. */
const clampOffset = (value: number) => Math.max(-12, Math.min(12, value));

/**
 * Pins are drawn through rather than solid, so a shop behind another is still
 * visible instead of being silently covered.
 */
const PIN_OPACITY = 0.72;

/** One line of label text, and roughly how wide a character of it is. */
const LABEL_HEIGHT = 15;
const CHARACTER_WIDTH = 5.4;

export interface MerchantMapProps {
  locations: readonly MerchantLocation[];
  /** Measured by the parent; tiles need a pixel width before they can be laid out. */
  width: number;
  currency: string;
  onSelect: (merchantNorm: string | null, label: string) => void;
  /**
   * Raised while a drag is in progress, so the screen can stop its own
   * scrolling from competing with the map's.
   */
  onDragChange?: (dragging: boolean) => void;
}

/** What is known about each address, keyed by the address itself. */
type Points = Record<string, GeoPoint | null>;

/**
 * The cache is synchronous, so shops already looked up are on the map in the
 * first frame. Going through an effect would blank the map on every visit for
 * coordinates already in hand.
 */
function seedFromCache(locations: readonly MerchantLocation[]): Points {
  const seed: Points = {};
  for (const location of locations) {
    const cached = readCache(location.address);
    if (cached.kind === 'hit') seed[location.address] = cached.point;
    if (cached.kind === 'miss') seed[location.address] = null;
  }
  return seed;
}

export function MerchantMap({
  locations,
  width,
  currency,
  onSelect,
  onDragChange,
}: MerchantMapProps) {
  const theme = useTheme();
  const [points, setPoints] = useState<Points>(() => seedFromCache(locations));
  /** Steps away from the fitted view, applied by the buttons. */
  const [zoomOffset, setZoomOffset] = useState(0);
  /**
   * Where the map has been dragged to, or null while it still sits where the
   * fit put it. A centre rather than a pixel offset: pixels mean different
   * distances at different zooms, so an offset would jump the moment the zoom
   * buttons were used.
   */
  const [centre, setCentre] = useState<LonLat | null>(null);

  /**
   * What the gesture needs to read, kept current without rebuilding the
   * responder. The values it wants are computed below the early return, so
   * they cannot be closed over at creation time.
   */
  const centreRef = useRef<LonLat>({ lat: 0, lon: 0 });
  const zoomRef = useRef(DEFAULT_ZOOM);
  /** Where the drag began, and the gesture offsets it started from. */
  const dragFrom = useRef<{ centre: LonLat; dx: number; dy: number } | null>(null);
  /** The spread and zoom a two-finger gesture began at. */
  const pinch = useRef<{ distance: number; offset: number } | null>(null);
  const zoomOffsetRef = useRef(0);
  /** Through a ref, so the responder does not need rebuilding when it changes. */
  const onDragChangeRef = useRef(onDragChange);

  /**
   * The gesture, built once.
   *
   * The lint rule objects to refs being passed into a function during render,
   * and it is right to be suspicious — three genuine instances of that were
   * fixed above by moving the ref writes into an effect. This one is the
   * heuristic misreading the code: `PanResponder.create` only *stores* these
   * callbacks, and the gesture system invokes them on touch events, never
   * while rendering. React may discard and re-run this initialiser, which
   * would build a second responder and drop the first — harmless, and the
   * refs it closes over are the same either way.
   */
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      /**
       * Claimed on touch, not on movement.
       *
       * Waiting for a few pixels of drag left the gesture with the Insights
       * ScrollView until then, and Android's native scroll view decides to
       * intercept on its own touch slop — so a vertical drag was a race. Near
       * the top and bottom edges it is always a vertical drag, because the
       * finger pulls toward the middle, which is why those edges scrolled the
       * page instead of moving the map.
       *
       * Children are asked first by the responder system, so pins and the
       * zoom buttons still take their own taps.
       */
      onStartShouldSetPanResponder: () => true,
      /**
       * On movement, only a real drag.
       *
       * This said `() => true`, which took the gesture away from whatever
       * child was being pressed at the first pixel of drift. `Pressable`
       * grants a termination request by default, so the zoom buttons were
       * being cancelled mid-tap — they were never covered, they were
       * interrupted.
       */
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > TAP_SLOP || Math.abs(gesture.dy) > TAP_SLOP,
      /**
       * And never hand it back. Without this the scroll view can ask for the
       * responder mid-drag and get it, which is the same bug arriving a few
       * frames later.
       */
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragFrom.current = { centre: centreRef.current, dx: 0, dy: 0 };
        pinch.current = null;
        onDragChangeRef.current?.(true);
      },
      onPanResponderMove: (event, gesture) => {
        const touches = event.nativeEvent.touches;

        if (touches.length >= 2) {
          const spread = touchDistance(touches[0], touches[1]);
          if (!pinch.current) {
            // A second finger has just landed: remember where it began, and
            // do not move the map on the frame that starts the pinch.
            pinch.current = { distance: spread, offset: zoomOffsetRef.current };
            return;
          }
          setZoomOffset(
            clampOffset(pinch.current.offset + zoomStepsFor(pinch.current.distance, spread))
          );
          return;
        }

        if (pinch.current) {
          // Back to one finger. `dx`/`dy` still count from the original touch
          // down, so the drag re-anchors here — otherwise the map jumps by
          // however far the hand travelled while pinching.
          pinch.current = null;
          dragFrom.current = { centre: centreRef.current, dx: gesture.dx, dy: gesture.dy };
          return;
        }

        const from = dragFrom.current;
        if (from) {
          setCentre(
            panCentre(from.centre, zoomRef.current, gesture.dx - from.dx, gesture.dy - from.dy)
          );
        }
      },
      onPanResponderRelease: () => {
        dragFrom.current = null;
        pinch.current = null;
        onDragChangeRef.current?.(false);
      },
      onPanResponderTerminate: () => {
        dragFrom.current = null;
        pinch.current = null;
        onDragChangeRef.current?.(false);
      },
    })
  );

  const addresses = locations.map((location) => location.address).join(' ');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      for (const location of locations) {
        if (cancelled) return;
        if (readCache(location.address).kind !== 'unknown') continue;

        try {
          const point = await geocode(location.address);
          // Only a definitive "no such place" is cached. A failed lookup may
          // succeed next time, and caching it would make one offline moment
          // permanent.
          writeCache(location.address, point);
          if (!cancelled) setPoints((current) => ({ ...current, [location.address]: point }));
        } catch {
          // Offline, or the service refused. The shop simply stays off the
          // map; the breakdown below it still shows the spending.
          if (!cancelled) return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `addresses` rather than `locations`: the array is rebuilt on every load
    // even when the same shops came back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses]);

  const placed = useMemo(
    () =>
      locations
        .map((location) => ({ location, point: points[location.address] }))
        .filter((entry): entry is { location: MerchantLocation; point: GeoPoint } =>
          Boolean(entry.point)
        ),
    [locations, points]
  );

  // One entry per place, rather than per merchant — see `spots.ts`.
  const spots = useMemo(() => mergeSpots(placed), [placed]);

  const view = useMemo(
    () => fitPoints(spots.map((spot) => spot.point), width, MAP_HEIGHT),
    [spots, width]
  );

  const resolving = placed.length < locations.length;

  // The fitted view is where the map starts, not where it has to stay.
  const zoom = view
    ? Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, view.zoom + zoomOffset))
    : DEFAULT_ZOOM;
  const focus = centre ?? view?.centre ?? null;

  /**
   * What the gesture reads, kept current.
   *
   * In an effect rather than during render: a ref is not render state, and
   * writing one while rendering is the kind of shortcut that survives testing
   * and breaks under concurrent rendering. A drag reads these in
   * `onPanResponderGrant`, long after this has run.
   */
  useEffect(() => {
    if (focus) centreRef.current = focus;
    zoomRef.current = zoom;
    zoomOffsetRef.current = zoomOffset;
    onDragChangeRef.current = onDragChange;
  }, [focus, zoom, zoomOffset, onDragChange]);

  // `focus` is non-null whenever `view` is; the second test is for the type
  // checker rather than for the running app.
  if (!view || !focus) {
    return (
      <View style={[styles.frame, { height: MAP_HEIGHT, backgroundColor: theme.backgroundElement }]}>
        <View style={styles.centred}>
          {resolving ? (
            <ActivityIndicator />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              None of these shop addresses could be found on a map.
            </ThemedText>
          )}
        </View>
      </View>
    );
  }

  const largest = Math.max(...spots.map((spot) => spot.totalCents), 1);
  const moved = centre !== null || zoomOffset !== 0;

  // Re-placed rather than reusing the fit's own placements, which were worked
  // out at the fitted centre and zoom.
  const placements = placePoints(
    spots.map((spot) => spot.point),
    focus,
    zoom,
    width,
    MAP_HEIGHT
  );

  /**
   * Everything each spot needs drawn, worked out once.
   *
   * The label's width is estimated from its text, the same approximation the
   * charts use — there is no measurement available before layout, and the
   * arrangement only needs to know roughly how much room each one wants.
   */
  const marks = spots.map((spot, index) => {
    const share = Math.sqrt(spot.totalCents / largest);
    const size = MIN_PIN + (MAX_PIN - MIN_PIN) * share;
    const amount = formatMoneyCompact(spot.totalCents, currency);
    const text = `${spot.label}  ${amount}`;

    return {
      spot,
      at: placements[index],
      size,
      amount,
      width: Math.min(150, Math.max(44, Math.round(text.length * CHARACTER_WIDTH) + 12)),
      colour: brandColour(spot.merchantNorm, spot.label),
    };
  });

  // Anchored just under each pin, then shuffled clear of one another.
  const labels = layoutLabels(
    marks.map((mark) => ({
      x: mark.at.x,
      y: mark.at.y + mark.size / 2 + 3,
      width: mark.width,
      height: LABEL_HEIGHT,
      weight: mark.spot.totalCents,
    })),
    MAP_HEIGHT,
    0
  );

  return (
    <View
      {...pan.panHandlers}
      style={[styles.frame, { width, height: MAP_HEIGHT, backgroundColor: theme.backgroundElement }]}>
      {tileGrid(focus, width, MAP_HEIGHT, zoom).map((tile) => (
        <Image
          key={tile.key}
          source={{ uri: tileUrl(OSM_TILE_TEMPLATE, tile), headers: OSM_TILE_HEADERS }}
          style={[styles.tile, { left: tile.left, top: tile.top }]}
          cachePolicy="disk"
          contentFit="cover"
          transition={150}
        />
      ))}

      {/*
        Drawn smallest first, so the biggest spend ends up on top.
        `mergeSpots` orders by amount descending — right for the data, and
        exactly backwards for painting, since React Native draws later
        siblings over earlier ones.
      */}
      {[...marks]
        .sort((a, b) => a.spot.totalCents - b.spot.totalCents)
        .map(({ spot, at, size, colour }) => {
          const others = spot.merchants.length - 1;

          return (
            <Pressable
              key={spot.key}
              onPress={() => onSelect(spot.merchantNorm, spot.label)}
              accessibilityRole="button"
              accessibilityLabel={
                `${spot.label}${others > 0 ? ` and ${others} other shop${others === 1 ? '' : 's'} here` : ''}, ` +
                `${formatMoney(spot.totalCents, currency)} across ` +
                `${spot.billCount} bill${spot.billCount === 1 ? '' : 's'}`
              }
              style={({ pressed }) => [
                styles.pin,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  left: at.x - size / 2,
                  top: at.y - size / 2,
                  backgroundColor: colour,
                  borderColor: theme.background,
                  opacity: pressed ? PIN_OPACITY * 0.6 : PIN_OPACITY,
                },
              ]}
            />
          );
        })}

      {/*
        Labels after every pin, so none is covered by a circle, and each one
        where `layoutLabels` put it. The name first and the amount after it on
        the same line; a label with nowhere free is dropped rather than piled
        on its neighbour, and its pin still answers a tap.
      */}
      {marks.map((mark, index) =>
        labels[index].hidden ? null : (
          <View
            key={`${mark.spot.key}-label`}
            pointerEvents="none"
            style={[
              styles.label,
              {
                width: mark.width,
                left: mark.at.x - mark.width / 2,
                top: mark.at.y + mark.size / 2 + 3 + labels[index].dy,
                backgroundColor: theme.background,
                borderColor: theme.border,
              },
            ]}>
            <ThemedText type="small" numberOfLines={1} style={styles.labelText}>
              {mark.spot.label}{'  '}
              <ThemedText type="small" style={styles.labelAmount}>
                {mark.amount}
              </ThemedText>
            </ThemedText>
          </View>
        )
      )}

      {/*
        Zooming in is what separates shops that sit on top of each other at the
        fitted view — two supermarkets in one suburb are one blob until the map
        can tell them apart.
      */}
      <View style={styles.zoom}>
        <ZoomButton
          label="Zoom in"
          symbol="+"
          disabled={zoom >= MAX_MAP_ZOOM}
          onPress={() => setZoomOffset((offset) => offset + 1)}
        />
        <ZoomButton
          label="Zoom out"
          symbol="−"
          disabled={zoom <= MIN_MAP_ZOOM}
          onPress={() => setZoomOffset((offset) => offset - 1)}
        />
        {/*
          Only once there is something to undo. Panning far enough to lose the
          pins is easy, and hunting for them by hand is not a puzzle worth
          setting.
        */}
        {moved && (
          <ZoomButton
            label="Recentre the map on your shops"
            // A bullseye from Geometric Shapes rather than U+2316: the zoom
            // buttons use characters every font carries, and a control that
            // renders as a tofu box on some devices is worse than a plainer
            // one that renders everywhere.
            symbol="◎"
            disabled={false}
            onPress={() => {
              setZoomOffset(0);
              setCentre(null);
            }}
          />
        )}
      </View>

      {/* ODbL requires the credit, and OSM asks for it on the map itself. */}
      <ThemedText type="small" style={styles.attribution}>
        © OpenStreetMap
      </ThemedText>
    </View>
  );
}

function ZoomButton({
  label,
  symbol,
  disabled,
  onPress,
}: {
  label: string;
  symbol: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.zoomButton,
        {
          backgroundColor: theme.background,
          borderColor: theme.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 0.95,
        },
      ]}>
      <ThemedText type="smallBold">{symbol}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: Radius.medium, overflow: 'hidden' },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  note: { textAlign: 'center' },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  pin: { position: 'absolute', borderWidth: 2 },
  label: {
    position: 'absolute',
    height: LABEL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.94,
  },
  labelText: { fontSize: 9.5, textAlign: 'center' },
  labelAmount: { fontSize: 9.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  resolving: { position: 'absolute', left: Spacing.two, top: Spacing.two },
  zoom: { position: 'absolute', right: Spacing.two, top: Spacing.two, gap: Spacing.one },
  zoomButton: {
    width: MinTouchTarget,
    height: MinTouchTarget,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attribution: {
    position: 'absolute',
    right: Spacing.one,
    bottom: 0,
    fontSize: 9,
    color: '#00000099',
  },
});
