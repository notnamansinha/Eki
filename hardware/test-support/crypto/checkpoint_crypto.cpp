#include "encrypted_checkpoint.h"
#include <cassert>
#include <cstdio>

static wifi_mode_t radio = WIFI_MODE_STA;
static int radioResult = ESP_OK;
static unsigned nonceCount = 0;
int esp_wifi_get_mode(wifi_mode_t *mode) { *mode = radio; return radioResult; }
// Deterministic test nonces only. This adapter does not certify ESP entropy.
void esp_fill_random(void *out, size_t size) {
  auto *bytes = static_cast<uint8_t *>(out);
  const unsigned count = ++nonceCount;
  for (size_t i = 0; i < size; ++i) bytes[i] = static_cast<uint8_t>(count + i);
}
struct Sample { uint32_t sequence; int32_t latE7; int32_t lngE7; uint32_t timestamp; };
using Codec = eki::checkpoint::EncryptedCodec<Sample>;
using Record = eki::checkpoint::Record;
struct MemoryStorage {
  static constexpr size_t PAGE_BYTES = 256;
  Record records[4];
  MemoryStorage() { std::memset(records, 0xff, sizeof(records)); }
  size_t recordCount() const { return 4; }
  bool read(size_t i, Record &record) { record = records[i]; return true; }
  bool write(size_t i, const Record &record) { records[i] = record; return true; }
  bool erasePage(size_t page) { std::memset(records + page * 2, 0xff, PAGE_BYTES); return true; }
};

int main() {
  const Sample sample{7, 230000000, 720000000, 1700000000};
  Codec codec;
  Record record{};
  assert(!codec.seal(1, sample, record));
  assert(codec.begin("host-test-secret-not-a-device-credential", 42));
  assert(codec.seal(5, sample, record));
  Sample opened{};
  uint32_t generation = 0;
  assert(codec.open(record, generation, opened));
  assert(generation == 5 && std::memcmp(&opened, &sample, sizeof(sample)) == 0);
  assert(std::memcmp(record.bytes + 32, &sample, sizeof(sample)) != 0);
  std::puts("checkpoint crypto: real AES-GCM round trip passed");

  // Authenticate every byte: header, nonce, reserved AAD, ciphertext and tag.
  for (size_t i = 0; i < sizeof(record.bytes); ++i) {
    Record changed = record;
    changed.bytes[i] ^= 1;
    Sample untouched{99, -1, -2, 3};
    const Sample before = untouched;
    generation = 123;
    assert(!codec.open(changed, generation, untouched));
    assert(generation == 123 && std::memcmp(&before, &untouched, sizeof(before)) == 0);
  }
  std::puts("checkpoint crypto: 128 byte-tamper cases and unchanged outputs passed");

  Codec wrongKey, wrongConfiguration;
  assert(wrongKey.begin("another-host-test-secret", 42));
  assert(wrongConfiguration.begin("host-test-secret-not-a-device-credential", 43));
  assert(!wrongKey.open(record, generation, opened));
  assert(!wrongConfiguration.open(record, generation, opened));
  Record second{};
  assert(codec.seal(6, sample, second));
  assert(std::memcmp(record.bytes + 16, second.bytes + 16, 12) != 0);
  assert(!codec.open(Record{}, generation, opened));
  std::puts("checkpoint crypto: key/configuration isolation and invalid record passed");

  MemoryStorage storage;
  eki::checkpoint::Journal<Sample, MemoryStorage, Codec> journal(storage, codec);
  assert(!journal.initialize() && journal.ready());
  assert(journal.append(sample));
  Sample newer = sample;
  newer.sequence = 8;
  assert(journal.append(newer));
  storage.records[1].bytes[80] ^= 1;
  eki::checkpoint::Journal<Sample, MemoryStorage, Codec> recovered(storage, codec);
  assert(recovered.initialize() && recovered.newest(opened));
  assert(opened.sequence == sample.sequence);
  eki::checkpoint::Journal<Sample, MemoryStorage, Codec> foreign(storage, wrongKey);
  assert(!foreign.initialize());
  std::puts("checkpoint crypto: journal recovers prior authenticated record and rejects foreign key");

  radio = WIFI_MODE_NULL;
  const Record before = second;
  const unsigned entropyCalls = nonceCount;
  assert(!codec.seal(7, sample, second));
  assert(std::memcmp(&before, &second, sizeof(second)) == 0 && entropyCalls == nonceCount);
  radio = WIFI_MODE_STA;
  radioResult = -1;
  assert(!codec.seal(7, sample, second));
  assert(std::memcmp(&before, &second, sizeof(second)) == 0 && entropyCalls == nonceCount);
  std::puts("checkpoint crypto: radio-off/error fails before entropy and record mutation");
}
