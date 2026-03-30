// frontend/src/components/step1/AddressSection.jsx

import React from "react";
import AddressAutocomplete from "../AddressAutocomplete.jsx";

export default function AddressSection({
  locked,
  addrSearch,
  setAddrSearch,
  dLocal,
  setDLocal,
  isNewAgreement,
  cacheKey,
  writeCache,
  patchAgreement,
  persistAddressNow,
  schedulePatch,
  onLocalChange,
}) {
  return (
    <>
      <div className="md:col-span-2">
        <label className="block text-sm font-medium mb-1">Address Search</label>
        <div className="mb-2 text-xs text-gray-500">
          Search first, then confirm the structured address fields below.
        </div>

        <AddressAutocomplete
          value={addrSearch}
          disabled={locked}
          onChangeText={(text) => {
            if (locked) return;
            setAddrSearch(text);
            if (!isNewAgreement) {
              writeCache({ address_search: text });
            }
          }}
          onSelect={(a) => {
            if (locked) return;

            const nextLine1 = a.line1 || dLocal.address_line1 || "";
            const nextCity = a.city || dLocal.address_city || "";
            const nextState = a.state || dLocal.address_state || "";
            const nextZip = a.postal_code || dLocal.address_postal_code || "";

            setAddrSearch(a.formatted_address || a.line1 || "");

            setDLocal((s) => ({
              ...s,
              address_line1: nextLine1,
              address_city: nextCity,
              address_state: nextState,
              address_postal_code: nextZip,
            }));

            patchAgreement(
              {
                address_line1: nextLine1,
                address_city: nextCity,
                address_state: nextState,
                address_postal_code: nextZip,
              },
              { silent: true }
            );

            try {
              if (!isNewAgreement) {
                const raw = sessionStorage.getItem(cacheKey);
                const saved = raw ? JSON.parse(raw) : {};
                saved.geo = {
                  place_id: a.place_id || "",
                  formatted_address: a.formatted_address || "",
                  lat: a.lat ?? null,
                  lng: a.lng ?? null,
                };
                saved.address_search = a.formatted_address || a.line1 || "";
                saved.address_line1 = nextLine1;
                saved.address_city = nextCity;
                saved.address_state = nextState;
                saved.address_postal_code = nextZip;
                sessionStorage.setItem(cacheKey, JSON.stringify(saved));
              }
            } catch {
              // ignore
            }
          }}
          placeholder="Start typing the street address (pick from suggestions)…"
        />
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium mb-1">
          Address Line 1 <span className="text-red-500">*</span>
        </label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          name="address_line1"
          value={dLocal.address_line1}
          onChange={
            locked
              ? undefined
              : (e) => {
                  onLocalChange(e);
                  schedulePatch({ address_line1: e.target.value });
                }
          }
          onBlur={() => persistAddressNow({ silent: true })}
          placeholder="Street address (e.g., 123 Main St)"
          disabled={locked}
        />
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium mb-1">Address Line 2 (optional)</label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          name="address_line2"
          value={dLocal.address_line2}
          onChange={
            locked
              ? undefined
              : (e) => {
                  onLocalChange(e);
                  schedulePatch({ address_line2: e.target.value });
                }
          }
          onBlur={() => persistAddressNow({ silent: true })}
          placeholder="Apt, suite, etc. (e.g., Apt 838)"
          disabled={locked}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          City <span className="text-red-500">*</span>
        </label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          name="address_city"
          value={dLocal.address_city}
          onChange={
            locked
              ? undefined
              : (e) => {
                  onLocalChange(e);
                  schedulePatch({ address_city: e.target.value });
                }
          }
          onBlur={() => persistAddressNow({ silent: true })}
          placeholder="City (e.g., San Antonio)"
          disabled={locked}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          State <span className="text-red-500">*</span>
        </label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          name="address_state"
          value={dLocal.address_state}
          onChange={
            locked
              ? undefined
              : (e) => {
                  onLocalChange(e);
                  schedulePatch({ address_state: e.target.value });
                }
          }
          onBlur={() => persistAddressNow({ silent: true })}
          placeholder="State (e.g., TX)"
          disabled={locked}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          ZIP / Postal Code <span className="text-red-500">*</span>
        </label>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          name="address_postal_code"
          value={dLocal.address_postal_code}
          onChange={
            locked
              ? undefined
              : (e) => {
                  onLocalChange(e);
                  schedulePatch({ address_postal_code: e.target.value });
                }
          }
          onBlur={() => persistAddressNow({ silent: true })}
          placeholder="ZIP / Postal code (e.g., 78249)"
          disabled={locked}
        />
      </div>
    </>
  );
}
