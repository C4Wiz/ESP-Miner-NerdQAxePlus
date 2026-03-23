#include "board.h"
#include "nerdqaxeplus2.h"

static const char* TAG="nerdqaxeplus2";

NerdQaxePlus2::NerdQaxePlus2() : NerdQaxePlus() {
    m_deviceModel = "NerdQAxe++";
    m_miningAgent = m_deviceModel;
    m_asicModel = "BM1370";
    m_asicCount = 4;
    m_numPhases = 3;
    m_imax = m_numPhases * 30;
    m_ifault = (float) (m_imax + 5);

    m_asicJobIntervalMs = 500;
    m_asicFrequencies = {500, 515, 525, 550, 575, 590, 600, 615, 625, 650, 675, 700, 715, 725, 750, 775, 800, 815, 825, 850}; // Added 615-850 to frequency dropdown
    m_asicVoltages = {1120, 1130, 1140, 1150, 1160, 1170, 1180, 1190, 1200, 1210, 1220, 1230, 1240, 1250, 1260, 1270, 1280, 1290, 1300, 1310, 1320, 1330, 1340, 1350, 1360, 1370, 1380, 1390, 1400}; // added 1210-1400 to voltage dropdown
    m_defaultAsicFrequency = m_asicFrequency = 600; // default frequency
    m_defaultAsicVoltageMillis = m_asicVoltageMillis = 1150; // default voltage
    m_absMaxAsicFrequency = 850; // max overclock now 850
    m_absMaxAsicVoltageMillis = 1400;
    m_initVoltageMillis = 1200;

<<<<<<< HEAD
    m_pidSettings.targetTemp = 60;
    m_pidSettings.p = 600;  //  6.00
    m_pidSettings.i = 10;   //  0.10
    m_pidSettings.d = 1000; // 10.00
=======
    m_pidSettings[0].targetTemp = 55;
    m_pidSettings[0].p = 600;  //  6.00
    m_pidSettings[0].i = 10;   //  0.10
    m_pidSettings[0].d = 1000; // 10.00
>>>>>>> upstream/develop

    m_maxPin = 144.0; // max power now 144w (12A fuse)
    m_minPin = 52.0;
    m_maxVin = 13.0;
    m_minVin = 11.0;
    m_minCurrentA = 0.0f;
    m_maxCurrentA = 12.0f; // max amps now 12a (12a fuse required)

    m_asicMaxDifficulty = 2048;
    m_asicMinDifficulty = 512;
    m_asicMinDifficultyDualPool = 256;

#ifdef NERDQAXEPLUS2
    m_theme = new ThemeNerdqaxeplus2();
#endif
    m_asics = new BM1370();
    m_hasHashCounter = true;
    m_vrFrequency = m_defaultVrFrequency = m_asics->getDefaultVrFrequency();
}

float NerdQaxePlus2::getTemperature(int index) {
    float temp = NerdQaxePlus::getTemperature(index);
    if (!temp) {
        return 0.0;
    }
    // we can't read the real chip temps but this should be about right
    return temp + 10.0f; // offset of 10°C
}

void NerdQaxePlus2::requestChipTemps() {
    // NOP
}
