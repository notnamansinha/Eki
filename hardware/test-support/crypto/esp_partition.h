#pragma once
#include <cstddef>
#define ESP_OK 0
#define ESP_PARTITION_TYPE_DATA 1
#define ESP_PARTITION_SUBTYPE_ANY 0xff
#define ESP_PARTITION_SUBTYPE_DATA_COREDUMP 3
struct esp_partition_t { size_t size; };
inline const esp_partition_t *esp_partition_find_first(int, int, const char *) { return nullptr; }
inline int esp_partition_read(const esp_partition_t *, size_t, void *, size_t) { return -1; }
inline int esp_partition_write(const esp_partition_t *, size_t, const void *, size_t) { return -1; }
inline int esp_partition_erase_range(const esp_partition_t *, size_t, size_t) { return -1; }
