import React, { useEffect, useRef, useState } from "react";

/**
 * AddressAutocomplete.jsx (MyHomeBro)
 *
 * Props:
 *  - value: string
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

function getRuntimeGoogleMapsApiKey() {
  if (typeof document === "undefined") return "";
  return (
    document
      .querySelector('meta[name="mhb-google-maps-api-key"]')
      ?.getAttribute("content")
      ?.trim() || ""
  );
}

function loadMapsOnce(apiKey) {
  if (__mhbMapsPromise) return __mhbMapsPromise;

  __mhbMapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }

    if (!apiKey) {
      reject(new Error("Missing Google Maps API key"));
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
  }).catch((error) => {
    __mhbMapsPromise = null;
    throw error;
  });

  return __mhbMapsPromise;
}

function pickComponent(components, type) {
  if (!Array.isArray(components)) return null;
  return (
    components.find((c) => {
      const types = Array.isArray(c?.types)
        ? c.types
        : Array.isArray(c?.componentTypes)
        ? c.componentTypes
        : [];
      return types.includes(type) || c?.type === type || c?.componentType === type;
    }) || null
  );
}

function firstAddressLineFromFormatted(value) {
  return String(value || "").split(",")[0]?.trim() || "";
}

function componentLongText(component) {
  if (!component) return "";
  return String(
    component.longText ||
      component.long_name ||
      component.name ||
      component.text ||
      ""
  ).trim();
}

function componentShortText(component) {
  if (!component) return "";
  return String(
    component.shortText ||
      component.short_name ||
      component.abbreviation ||
      componentLongText(component) ||
      ""
  ).trim();
}

function parseAddressComponentsFromPlace(place) {
  const comps = place?.addressComponents || place?.address_components || [];

  const formattedLine1 = firstAddressLineFromFormatted(
    place?.formattedAddress || place?.formatted_address
  );

  const streetNumber = componentLongText(pickComponent(comps, "street_number"));
  const route = componentLongText(pickComponent(comps, "route"));

  let line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  if (formattedLine1) {
    const normalizedFormatted = formattedLine1.toLowerCase();
    const normalizedLine1 = line1.toLowerCase();
    const normalizedRoute = route.toLowerCase();
    if (
      !line1 ||
      (route &&
        normalizedFormatted.includes(normalizedRoute) &&
        normalizedFormatted !== normalizedLine1)
    ) {
      line1 = formattedLine1;
    }
  }

  const city =
    componentLongText(pickComponent(comps, "locality")) ||
    componentLongText(pickComponent(comps, "sublocality")) ||
    componentLongText(pickComponent(comps, "sublocality_level_1")) ||
    componentLongText(pickComponent(comps, "postal_town")) ||
    "";

  const state = componentShortText(pickComponent(comps, "administrative_area_level_1"));
  const postal = componentLongText(pickComponent(comps, "postal_code"));
  const postalSuffix = componentLongText(pickComponent(comps, "postal_code_suffix"));
  const postal_code = postalSuffix ? `${postal}-${postalSuffix}` : postal;
  const country = componentShortText(pickComponent(comps, "country")) || "US";

  return { line1, city, state, postal_code, country };
}

function getPredictionText(prediction) {
  return String(
    prediction?.description ||
      prediction?.text?.text ||
      prediction?.structured_formatting?.main_text ||
      ""
  ).trim();
}

function getPredictionPlaceId(prediction) {
  return String(
    prediction?.place_id ||
      prediction?.placeId ||
      prediction?.placePrediction?.placeId ||
      prediction?.placePrediction?.place_id ||
      ""
  ).trim();
}

function fetchPlacePredictions(service, request) {
  return new Promise((resolve, reject) => {
    try {
      const result = service.getPlacePredictions(request, (predictions, status) => {
        const statuses = window.google?.maps?.places?.PlacesServiceStatus || {};
        if (status && status !== statuses.OK && status !== statuses.ZERO_RESULTS) {
          reject(new Error(`Google Places prediction failed: ${status}`));
          return;
        }
        resolve(Array.isArray(predictions) ? predictions : []);
      });

      if (result?.then) {
        result
          .then((response) =>
            resolve(Array.isArray(response?.predictions) ? response.predictions : [])
          )
          .catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function fetchPlaceDetails(service, request) {
  return new Promise((resolve, reject) => {
    try {
      const result = service.getDetails(request, (place, status) => {
        const statuses = window.google?.maps?.places?.PlacesServiceStatus || {};
        if (status && status !== statuses.OK) {
          reject(new Error(`Google Places details failed: ${status}`));
          return;
        }
        resolve(place || {});
      });

      if (result?.then) {
        result.then(resolve).catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

export default function AddressAutocomplete({
  value = "",
  onChangeText,
  onSelect,
  country = "us",
  placeholder = "Start typing an address...",
  disabled = false,
  testId = "",
}) {
  const apiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || getRuntimeGoogleMapsApiKey();

  const detailsHostRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const detailsServiceRef = useRef(null);
  const sessionTokenRef = useRef(null);
  const requestSeqRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [inputValue, setInputValue] = useState(value || "");
  const [predictions, setPredictions] = useState([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setErr("");
      setReady(false);

      try {
        await loadMapsOnce(apiKey);
        if (cancelled) return;

        const placesLibrary = await window.google.maps.importLibrary("places");
        if (cancelled) return;

        const AutocompleteService =
          placesLibrary?.AutocompleteService ||
          window.google?.maps?.places?.AutocompleteService;
        const PlacesService =
          placesLibrary?.PlacesService || window.google?.maps?.places?.PlacesService;
        const AutocompleteSessionToken =
          placesLibrary?.AutocompleteSessionToken ||
          window.google?.maps?.places?.AutocompleteSessionToken;

        if (!AutocompleteService || !PlacesService) {
          throw new Error("Google Places autocomplete is unavailable.");
        }

        autocompleteServiceRef.current = new AutocompleteService();
        detailsServiceRef.current = new PlacesService(detailsHostRef.current);
        sessionTokenRef.current = AutocompleteSessionToken
          ? new AutocompleteSessionToken()
          : null;
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
  }, [apiKey]);

  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  useEffect(() => {
    if (!ready || disabled) {
      setPredictions([]);
      return;
    }

    const query = String(inputValue || "").trim();
    if (query.length < 2) {
      setPredictions([]);
      return;
    }

    const service = autocompleteServiceRef.current;
    if (!service) return;

    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setLoadingPredictions(true);

    const timer = setTimeout(async () => {
      try {
        const next = await fetchPlacePredictions(service, {
          input: query,
          componentRestrictions: country ? { country } : undefined,
          types: ["address"],
          sessionToken: sessionTokenRef.current || undefined,
        });
        if (requestSeqRef.current === seq) {
          setPredictions(next.slice(0, 6));
        }
      } catch (error) {
        console.error(error);
        if (requestSeqRef.current === seq) {
          setPredictions([]);
          setErr("Unable to load address suggestions.");
        }
      } finally {
        if (requestSeqRef.current === seq) {
          setLoadingPredictions(false);
        }
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [country, disabled, inputValue, ready]);

  function handleInputChange(event) {
    const next = event.target.value;
    setInputValue(next);
    setErr("");
    onChangeText?.(next);
  }

  async function handleSelectPrediction(prediction) {
    if (disabled) return;

    const detailsService = detailsServiceRef.current;
    const placeId = getPredictionPlaceId(prediction);
    const predictionText = getPredictionText(prediction);

    if (!detailsService || !placeId) {
      setInputValue(predictionText);
      onChangeText?.(predictionText);
      setPredictions([]);
      return;
    }

    try {
      const place = await fetchPlaceDetails(detailsService, {
        placeId,
        fields: ["formatted_address", "geometry", "address_components", "place_id"],
        sessionToken: sessionTokenRef.current || undefined,
      });

      const formatted_address =
        place?.formatted_address || place?.formattedAddress || predictionText || "";
      const place_id = place?.place_id || place?.id || placeId;
      const location = place?.geometry?.location || place?.location;
      const lat =
        typeof location?.lat === "function" ? location.lat() : location?.lat ?? null;
      const lng =
        typeof location?.lng === "function" ? location.lng() : location?.lng ?? null;
      const parts = parseAddressComponentsFromPlace(place);

      setInputValue(formatted_address || parts.line1 || "");
      setPredictions([]);
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
  }

  return (
    <div className="relative w-full" data-testid={testId || undefined}>
      <input
        aria-label="Google address search"
        autoComplete="off"
        className="w-full rounded border px-3 py-2 text-sm"
        disabled={disabled}
        onChange={handleInputChange}
        placeholder={placeholder}
        type="text"
        value={inputValue || ""}
      />
      {predictions.length ? (
        <div
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white text-sm shadow-xl"
          data-testid="address-autocomplete-suggestions"
        >
          {predictions.map((prediction, index) => {
            const label = getPredictionText(prediction);
            const key = getPredictionPlaceId(prediction) || `${label}-${index}`;
            return (
              <button
                className="block w-full px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50"
                key={key}
                onClick={() => handleSelectPrediction(prediction)}
                type="button"
              >
                {label || "Address suggestion"}
              </button>
            );
          })}
        </div>
      ) : null}
      {!ready && !err ? (
        <div className="mt-1 text-xs text-slate-500">Loading address suggestions...</div>
      ) : null}
      {ready && loadingPredictions ? (
        <div className="mt-1 text-xs text-slate-500">Finding address suggestions...</div>
      ) : null}
      {err ? <div className="mt-1 text-sm text-red-600">{err}</div> : null}
      <div ref={detailsHostRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
