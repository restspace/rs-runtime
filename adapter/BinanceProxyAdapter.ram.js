export default {
    "name": "Binance API Proxy Adapter",
    "description": "Forwards a request to a the Binance API using provided API keys",
    "moduleUrl": "./adapter/BinanceProxyAdapter.ts",
    "configSchema": {
        "type": "object",
        "properties": {
            "apiKey": { "type": "string", "description": "Binance API key" },
            "secretKey": { "type": "string", "description": "Binance private key for API" }
        }
    },
    "adapterInterfaces": [ "IProxyAdapter" ]
}