function decodePolyline(encoded) {
  let points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charAt(index++).charCodeAt(0) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charAt(index++).charCodeAt(0) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const polyline = "aarkCofwyL|@K|@EY_Bw@iEScAk@kEIoCk@eM]iGC[`AOfFk@hB[zBk@v@UAOAOK{@iA{K[yC]wDSsCO_Bi@?G?ECsEHeB?uCFm@DWFK@E@@G@{@@i@G}B";
const waypoints = decodePolyline(polyline);
console.log(JSON.stringify(waypoints, null, 2));
