import React, { useEffect, useRef, useState } from "react";

/**
 * AddressAutocomplete.jsx (MyHomeBro) — Places "New" Widget
 *
 * FIXED:
 *  - Reflects external `value` into the widget input so saved street address displays on load
 *  - Still uses gmp-select to return structured components
 *
 * Props:
 *  - value: string (display mirror; will be pushed into widget input)
 *  - onChangeText: (text: string) => void
 *  - onSelect: (addrObj) => void
 *  - country: default "us"
 *  - placeholder
 *
 * addrObj returned:
 *  {
 *    line1, line2, city, state, postal_code, country,
 *    formatted_address, place_id, lat, lng
 *  }
 */

let __mhbMapsPromise = null;

function loadMapsOnce(apiKey) {
  if (__mhbMapsPromise) return __mhbMapsPromise;

  __mhbMapsPromise = new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error("Missing VITE_GOOGLE_MAPS_API_KEY"));
      return;
    }

    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(apiKey)}` +
      "&loading=async&libraries=places&v=weekly";
    script.async = true;
    script.defer = true;

    function waitForImportLibrary(timeoutMs = 6000) {
      return new Promise((res, rej) => {
        const start = Date.now();
        const tick = () => {
          if (window.google?.maps?.importLibrary) return res();
          if (Date.now() - start > timeoutMs) {
            return rej(
              new Error(
                "Google Maps loaded but importLibrary is still missing (timeout)."
              )
            );
          }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    script.onload = async () => {
      try {
        await waitForImportLibrary(6000);
        resolve();
      } catch (e) {
        reject(e);
      }
    };

    script.onerror = () =>
      reject(new Error("Failed to load Google Maps JS API script."));

    document.head.appendChild(script);
  });

  return __mhbMapsPromise;
}

function pickComponent(components, type) {
  if (!Array.isArray(components)) return null;
  return (
    components.find((c) => Array.isArray(c.types) && c.types.includes(type)) ||
    null
  );
}

function parseAddressComponentsFromPlace(place) {
  const comps =
    place?.addressComponents ||
    place?.address_components ||
    place?.address_components?.map?.((x) => x) ||
    [];

  const streetNumber =
    pickComponent(comps, "street_number")?.longText ||
    pickComponent(comps, "street_number")?.long_name ||
    "";

  const route =
    pickComponent(comps, "route")?.longText ||
    pickComponent(comps, "route")?.long_name ||
    "";

  const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();

  const city =
    pickComponent(comps, "locality")?.longText ||
    pickComponent(comps, "locality")?.long_name ||
    pickComponent(comps, "sublocality")?.longText ||
    pickComponent(comps, "sublocality")?.long_name ||
    pickComponent(comps, "postal_town")?.longText ||
    pickComponent(comps, "postal_town")?.long_name ||
    "";

  const state =
    pickComponent(comps, "administrative_area_level_1")?.shortText ||
    pickComponent(comps, "administrative_area_level_1")?.short_name ||
    "";

  const postal =
    pickComponent(comps, "postal_code")?.longText ||
    pickComponent(comps, "postal_code")?.long_name ||
    "";

  const postalSuffix =
    pickComponent(comps, "postal_code_suffix")?.longText ||
    pickComponent(comps, "postal_code_suffix")?.long_name ||
    "";

  // ZIP+4 if suffix exists
  const postal_code = postalSuffix ? `${postal}-${postalSuffix}` : postal;

  const country =
    pickComponent(comps, "country")?.shortText ||
    pickComponent(comps, "country")?.short_name ||
    "US";

  return { line1, city, state, postal_code, country };
}

// --- NEW helper: set internal widget input value ---
function setWidgetInputValue(hostEl, text) {
  if (!hostEl) return;
  const input = hostEl.querySelector("input");
  if (!input) return;
  // Only set if different (avoids cursor jumps while typing)
  if (String(input.value || "") !== String(text || "")) {
    input.value = text || "";
  }
}

export default function AddressAutocomplete({
  value = "",
  onChangeText,
  onSelect,
  country = "us",
  placeholder = "Start typing an address…",
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const hostRef = useRef(null);
  const widgetRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setErr("");
      setReady(false);

      try {
        await loadMapsOnce(apiKey);
        if (cancelled) return;

        await window.google.maps.importLibrary("places");
        if (cancelled) return;

        const widget = new window.google.maps.places.PlaceAutocompleteElement({});
        widget.placeholder = placeholder;
        widget.includedRegionCodes = [country];

        widget.addEventListener("gmp-select", async ({ placePrediction }) => {
          try {
            const place = placePrediction.toPlace();

            await place.fetchFields({
              fields: ["formattedAddress", "location", "addressComponents", "id"],
            });

            const formatted_address = place.formattedAddress || "";
            const place_id = place.id || "";
            const lat = place.location?.lat ?? null;
            const lng = place.location?.lng ?? null;

            const parts = parseAddressComponentsFromPlace(place);

            // Update widget input text to the formatted address (nice UX)
            if (hostRef.current) {
              setWidgetInputValue(hostRef.current, formatted_address || parts.line1 || "");
            }

            onChangeText?.(formatted_address || parts.line1 || "");
            onSelect?.({
              ...parts,
              line2: "",
              formatted_address,
              place_id,
              lat,
              lng,
            });
          } catch (e) {
            console.error(e);
            setErr("Unable to read selected address details.");
          }
        });

        if (hostRef.current) {
          hostRef.current.innerHTML = "";
          hostRef.current.appendChild(widget);
          widgetRef.current = widget;

          // ✅ push initial value into widget input on mount
          setWidgetInputValue(hostRef.current, value || "");
        }

        setReady(true);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load Google Places.");
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [apiKey, country, placeholder]);

  // ✅ when `value` changes (ex: profile loads), update widget input
  useEffect(() => {
    if (!hostRef.current) return;
    setWidgetInputValue(hostRef.current, value || "");
  }, [value]);

  return (
    <div className="w-full">
      <div ref={hostRef} />
      {!ready && !err ? (
        <div className="mt-1 text-xs text-slate-500">Loading address suggestions…</div>
      ) : null}
      {err ? <div className="mt-1 text-sm text-red-600">{err}</div> : null}
      <input type="hidden" value={value || ""} readOnly />
    </div>
  );
}