#pragma once
// Host adapter: exercise the production codec with real Mbed TLS primitives.
// ESP hardware acceleration, radio entropy and partition I/O are not simulated.
#define MBEDTLS_AES_C
#define MBEDTLS_CIPHER_C
#define MBEDTLS_GCM_C
#define MBEDTLS_MD_C
#define MBEDTLS_SHA256_C
