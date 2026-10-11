#include <TinyGPSPlus.h>
#include "telemetry_policy.h"
#include <cassert>
#include <cstdio>
#include <string>
uint32_t testMillis = 1000;

static std::string sentence(const std::string &body) {
  unsigned checksum = 0;
  for (char c : body) checksum ^= static_cast<unsigned char>(c);
  char suffix[8];
  std::snprintf(suffix, sizeof(suffix), "*%02X\r\n", checksum);
  return "$" + body + suffix;
}
static void feed(TinyGPSPlus &gps, const std::string &bytes) {
  for (char c : bytes) gps.encode(c);
}
static bool fresh(TinyGPSPlus &gps) {
  return eki::telemetry::gnssFixFieldsAreFresh(
    gps.location.isValid(), gps.location.age(), gps.hdop.isValid(), gps.hdop.age(),
    gps.speed.isValid(), gps.speed.age(), gps.course.isValid(), gps.course.age());
}
int main() {
  TinyGPSPlus gps;
  const auto rmc = sentence("GNRMC,123519.00,A,2300.0000,N,07200.0000,E,0.0,90.0,111026,,,A");
  const auto gga = sentence("GNGGA,123519.00,2300.0000,N,07200.0000,E,1,08,0.9,10.0,M,0.0,M,,");
  feed(gps, rmc.substr(0, rmc.size() - 5));
  assert(!gps.location.isValid());
  feed(gps, rmc.substr(rmc.size() - 5));
  feed(gps, gga);
  assert(fresh(gps));
  assert(std::abs(gps.location.lat() - 23.0) < 1e-8);
  assert(std::abs(gps.location.lng() - 72.0) < 1e-8);
  assert(gps.satellites.value() == 8 && std::abs(gps.hdop.hdop() - 0.9) < 1e-8);
  assert(gps.date.year() == 2026 && gps.date.month() == 10 && gps.date.day() == 11);
  std::puts("NMEA: fragmented GN RMC/GGA fix, coordinates, UTC and HDOP passed");

  testMillis += 1000;
  auto corrupt = sentence("GNRMC,123520.00,A,2400.0000,N,07300.0000,E,0.0,90.0,111026,,,A");
  corrupt[corrupt.find('*') + 1] = corrupt[corrupt.find('*') + 1] == '0' ? '1' : '0';
  feed(gps, corrupt);
  assert(gps.failedChecksum() == 1 && gps.location.age() == 1000);
  assert(std::abs(gps.location.lat() - 23.0) < 1e-8);
  std::puts("NMEA: bad checksum does not commit position or refresh age");

  // Valid no-fix sentences keep the old coordinate in TinyGPS++; production
  // freshness must expire it rather than treating sentence traffic as fixes.
  feed(gps, sentence("GNRMC,123521.00,V,,,,,,,111026,,,N"));
  feed(gps, sentence("GNGGA,123521.00,,,,,0,00,99.9,,,,,,"));
  testMillis = 6001;
  assert(!fresh(gps));
  feed(gps, rmc);
  feed(gps, gga);
  assert(fresh(gps));
  std::puts("NMEA: no-fix traffic expires and a valid fix reacquires");

  testMillis = UINT32_MAX - 500;
  feed(gps, rmc);
  feed(gps, gga);
  testMillis = 499;
  assert(gps.location.age() == 1000 && fresh(gps));
  testMillis = 5000;
  assert(!fresh(gps));
  std::puts("NMEA: receiver age and production freshness survive millis rollover");
}
