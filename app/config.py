from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str

    # Question generation (optional — falls back to a template draft if unset)
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"

    # Smartbot BFF (optional — BFF returns a stub reply if unset)
    SMARTBOT_URL: str = "https://assistant-stream.vnpt.vn/v1/conversation"
    BOT_ID: str = ""
    SMARTBOT_ACCESS_TOKEN: str = ""
    SMARTBOT_TOKEN_ID: str = ""
    SMARTBOT_TOKEN_KEY: str = ""

    # VNPT SmartVoice STT/TTS — separate creds per service (VNPT issues them
    # per service). Shared base URL. Front end falls back to browser Web Speech
    # for whichever service is unset. Creds kept server-side.
    SMARTVOICE_BASE_URL: str = "https://api.idg.vnpt.vn"
    # TTS voice: region (female_north|female_north_ngochoa|female_central|
    # female_south|male_north|male_central|male_south) and read speed [0.5-2].
    SMARTVOICE_TTS_REGION: str = "female_north_ngochoa"
    SMARTVOICE_TTS_SPEED: str = "0.9"
    SMARTVOICE_STT_ACCESS_TOKEN: str = ""
    SMARTVOICE_STT_TOKEN_ID: str = ""
    SMARTVOICE_STT_TOKEN_KEY: str = ""
    SMARTVOICE_TTS_ACCESS_TOKEN: str = ""
    SMARTVOICE_TTS_TOKEN_ID: str = ""
    SMARTVOICE_TTS_TOKEN_KEY: str = ""

    @property
    def smartbot_configured(self) -> bool:
        return bool(self.BOT_ID and self.SMARTBOT_ACCESS_TOKEN
                    and self.SMARTBOT_TOKEN_ID and self.SMARTBOT_TOKEN_KEY)

    @property
    def smartvoice_stt_configured(self) -> bool:
        return bool(self.SMARTVOICE_STT_ACCESS_TOKEN and self.SMARTVOICE_STT_TOKEN_ID
                    and self.SMARTVOICE_STT_TOKEN_KEY)

    @property
    def smartvoice_tts_configured(self) -> bool:
        return bool(self.SMARTVOICE_TTS_ACCESS_TOKEN and self.SMARTVOICE_TTS_TOKEN_ID
                    and self.SMARTVOICE_TTS_TOKEN_KEY)


settings = Settings()
