#include <WiFi.h>
#include <ArduinoWebsockets.h>

using namespace websockets;

// --- Configurações de Rede ---
const char* ssid = "Central";
const char* password = "12345678";
const char* ws_server_url = "ws://192.168.137.1:3000"; // Seu IP verificado no cmd

// --- Pinos do HC-SR04 ---
const int PIN_TRIG = 5;
const int PIN_ECHO = 18;

// --- Configurações da Cuba (Medidas Reais) ---
const char* CUBA_ID = "cuba_1";     // ID da cuba no seu data.json
const float DISTANCIA_VAZIA = 15.0; // 10cm da cuba + 5cm de folga
const float DISTANCIA_CHEIA = 5.0;  // Topo da cuba (5cm do sensor)

WebsocketsClient client;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi Conectado!");

  client.onMessage([](WebsocketsMessage msg) {
    Serial.print("Servidor diz: "); Serial.println(msg.data());
  });

  client.connect(ws_server_url);
}

void loop() {
  if (client.available()) {
    client.poll();
    
    // 1. Leitura do Sensor
    digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);
    long duracao = pulseIn(PIN_ECHO, HIGH);
    float distancia = duracao * 0.034 / 2;

    // 2. Lógica para 10 Faixas
    int faixas = 0;
    if (distancia >= DISTANCIA_VAZIA) {
      faixas = 0; // Vazia
    } else if (distancia <= DISTANCIA_CHEIA) {
      faixas = 10; // 100% Cheia
    } else {
      // Mapeia o intervalo de 4cm a 15cm para 10 a 0 faixas
      float progresso = (DISTANCIA_VAZIA - distancia) / (DISTANCIA_VAZIA - DISTANCIA_CHEIA);
      faixas = (int)(progresso * 10);
    }

    // Garante que fique entre 0 e 10
    faixas = constrain(faixas, 0, 10);

    // 3. Envio via WebSocket
    String json = "{\"type\":\"ATUALIZAR_CUBA\",\"id\":\"" + String(CUBA_ID) + "\",\"faixas\":" + String(faixas) + "}";
    Serial.printf("Dist: %.2f cm | Enviando Faixa: %d\n", distancia, faixas);
    client.send(json);
    
    delay(3000); // Envia a cada 3 segundos para tempo real fluido
  } else {
    client.connect(ws_server_url);
    delay(2000);
  }
}