#pragma once
#include <cstdint>
#include <cmath>
using byte = uint8_t;
extern uint32_t testMillis;
inline uint32_t millis() { return testMillis; }
constexpr double PI = 3.14159265358979323846;
constexpr double TWO_PI = 2 * PI;
inline double radians(double x) { return x * PI / 180; }
inline double degrees(double x) { return x * 180 / PI; }
inline double sq(double x) { return x * x; }
