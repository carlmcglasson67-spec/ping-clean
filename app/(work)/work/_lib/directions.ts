/**
 * A directions link that opens the phone's maps app (Google Maps on Android, and on
 * iPhone it offers Google Maps or the browser). Uses the pin when Ping has one, else the
 * address. Built only on the Today screen, only for a claimed job: it carries the address.
 */
export function directionsUrl(p: {
  address_line1: string;
  town: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
}): string {
  const destination =
    p.latitude != null && p.longitude != null ? `${p.latitude},${p.longitude}` : `${p.address_line1}, ${p.town} ${p.postcode}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
