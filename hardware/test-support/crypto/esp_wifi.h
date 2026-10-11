#pragma once
enum wifi_mode_t { WIFI_MODE_NULL, WIFI_MODE_STA };
int esp_wifi_get_mode(wifi_mode_t *);
