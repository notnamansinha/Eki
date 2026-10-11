#pragma once
#include "FreeRTOS.h"
extern TaskHandle_t testTask;
inline TaskHandle_t xTaskGetCurrentTaskHandle() { return testTask; }
