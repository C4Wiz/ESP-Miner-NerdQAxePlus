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
    m_asicFrequencies = {600, 615, 625, 650, 675, 690, 700, 715, 725, 750, 775, 790, 800, 805, 810, 815, 820, 825, 830, 835, 840, 845, 850, 855, 860, 865, 870, 875, 880, 885, 890, 895, 900, 905, 910, 915, 920, 925, 930, 935, 940, 945, 950};
    m_asicVoltages = {1150, 1160, 1170, 1180, 1190, 1200, 1205, 1210, 1215, 1220, 1225, 1230, 1235, 1240, 1245, 1250, 1255, 1260, 1265, 1270, 1275, 1280, 1285, 1290, 1295, 1300, 1305, 1310, 1315, 1320, 1325, 1330, 1335, 1340, 1345, 1350, 1355, 1360, 1365, 1370, 1375, 1380, 1385, 1390, 1395, 1400};
    m_defaultAsicFrequency = m_asicFrequency = 600; // default frequency
    m_defaultAsicVoltageMillis = m_asicVoltageMillis = 1150; // default voltage
    m_absMaxAsicFrequency = 950; // max overclock 950
    m_absMaxAsicVoltageMillis = 1400;
    m_initVoltageMillis = 1200;
    
    m_pidSettings[0].targetTemp = 60;
    m_pidSettings[0].p = 600;  //  6.00
    m_pidSettings[0].i = 10;   //  0.10
    m_pidSettings[0].d = 1000; // 10.00

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
