import React, { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

export const useSettings = () => useContext(SettingsContext);

const safeLocalStorageGet = (key, fallback = null) => {
    try {
        if (typeof localStorage === 'undefined') return fallback;
        const value = localStorage.getItem(key);
        return value ?? fallback;
    } catch (_error) {
        return fallback;
    }
};

const safeLocalStorageSet = (key, value) => {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, value);
    } catch (_error) {
    }
};

const safeJsonParse = (rawValue, fallback) => {
    if (!rawValue) return fallback;
    try {
        return JSON.parse(rawValue);
    } catch (_error) {
        return fallback;
    }
};

export const SettingsProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => safeLocalStorageGet('sop-theme', 'dark'));
    const [language, setLanguage] = useState(() => safeLocalStorageGet('sop-lang', 'EN'));
    const [unitSystem, setUnitSystem] = useState(() => safeLocalStorageGet('sop-units', 'metric'));
    const [country, setCountry] = useState(() => safeLocalStorageGet('sop-country', 'TR'));
    const [mainPortionSize, setMainPortionSize] = useState(() => parseInt(safeLocalStorageGet('sop-main-portion', '295'), 10) || 295);
    const [sidePortionSize, setSidePortionSize] = useState(() => parseInt(safeLocalStorageGet('sop-side-portion', '100'), 10) || 100);
    const [starterPortionSize, setStarterPortionSize] = useState(() => parseInt(safeLocalStorageGet('sop-starter-portion', '165'), 10) || 165);
    const [prepMainPortionSize, setPrepMainPortionSize] = useState(() => parseInt(safeLocalStorageGet('cabij-prep-main-portion', '295'), 10) || 295);
    const [prepStarterPortionSize, setPrepStarterPortionSize] = useState(() => parseInt(safeLocalStorageGet('cabij-prep-starter-portion', '165'), 10) || 165);
    const [prepComponentPortionSize, setPrepComponentPortionSize] = useState(() => parseInt(safeLocalStorageGet('cabij-prep-component-portion', '80'), 10) || 80);
    const [prepDipPortionSize, setPrepDipPortionSize] = useState(() => parseInt(safeLocalStorageGet('cabij-prep-dip-portion', '50'), 10) || 50);
    const [prepMarinadePortionSize, setPrepMarinadePortionSize] = useState(() => parseInt(safeLocalStorageGet('cabij-prep-marinade-portion', '110'), 10) || 110);
    const [volumeFocus, setVolumeFocus] = useState(() => parseInt(safeLocalStorageGet('sop-volume-focus', '50'), 10) || 50);
    const [portionsPerBatch, setPortionsPerBatch] = useState(() => parseInt(safeLocalStorageGet('sop-portions-per-batch', '50'), 10) || 50);
    const [batchSettings, setBatchSettings] = useState(() => {
        const saved = safeLocalStorageGet('sop-batch-settings');
        return safeJsonParse(saved, {
            defaultPortionsPerBatch: 50,
            minPortions: 50
        });
    });

    useEffect(() => {
        safeLocalStorageSet('sop-theme', theme);
        document.documentElement.className = theme;
    }, [theme]);

    useEffect(() => {
        safeLocalStorageSet('sop-lang', language);
    }, [language]);

    useEffect(() => {
        safeLocalStorageSet('sop-units', unitSystem);
    }, [unitSystem]);

    useEffect(() => {
        safeLocalStorageSet('sop-country', country);
    }, [country]);

    useEffect(() => {
        safeLocalStorageSet('sop-volume-focus', String(volumeFocus));
    }, [volumeFocus]);

    useEffect(() => {
        safeLocalStorageSet('sop-portions-per-batch', String(portionsPerBatch));
    }, [portionsPerBatch]);

    useEffect(() => {
        safeLocalStorageSet('sop-main-portion', String(mainPortionSize));
    }, [mainPortionSize]);

    useEffect(() => {
        safeLocalStorageSet('sop-side-portion', String(sidePortionSize));
    }, [sidePortionSize]);

    useEffect(() => {
        safeLocalStorageSet('sop-starter-portion', String(starterPortionSize));
    }, [starterPortionSize]);

    useEffect(() => {
        safeLocalStorageSet('cabij-prep-main-portion', String(prepMainPortionSize));
    }, [prepMainPortionSize]);

    useEffect(() => {
        safeLocalStorageSet('cabij-prep-starter-portion', String(prepStarterPortionSize));
    }, [prepStarterPortionSize]);

    useEffect(() => {
        safeLocalStorageSet('cabij-prep-component-portion', String(prepComponentPortionSize));
    }, [prepComponentPortionSize]);

    useEffect(() => {
        safeLocalStorageSet('cabij-prep-dip-portion', String(prepDipPortionSize));
    }, [prepDipPortionSize]);

    useEffect(() => {
        safeLocalStorageSet('cabij-prep-marinade-portion', String(prepMarinadePortionSize));
    }, [prepMarinadePortionSize]);

    useEffect(() => {
        safeLocalStorageSet('sop-batch-settings', JSON.stringify(batchSettings));
    }, [batchSettings]);

    // Simple Ingredient Translation Dictionary
    const DICTIONARY = {
        'chicken': 'Tavuk',
        'onion': 'Soğan',
        'garlic': 'Sarımsak',
        'ginger': 'Zencefil',
        'carrot': 'Havuç',
        'cabbage': 'Lahana',
        'napa cabbage': 'Çin Lahanası',
        'water': 'Su',
        'salt': 'Tuz',
        'sugar': 'Şeker',
        'soy sauce': 'Soya Sosu',
        'sesame oil': 'Susam Yağı',
        'vinegar': 'Sirke',
        'flour': 'Un',
        'oil': 'Yağ',
        'beef': 'Dana Eti',
        'pork': 'Domuz Eti',
        'egg': 'Yumurta',
        'milk': 'Süt',
        'cream': 'Krema',
        'butter': 'Tereyağı',
        'pepper': 'Biber',
        'black pepper': 'Karabiber',
        'rice': 'Pirinç',
        'potato': 'Patates',
        'honey': 'Bal',
        'green onion': 'Yeşil Soğan',
        'scallion': 'Taze Soğan',
        'leek': 'Pırasa',
        'mushroom': 'Mantar',
        'cucumber': 'Salatalık',
        'radish': 'Turp',
        'daikon': 'Japon Turpu',
        'shrimp': 'Karides',
        'fish': 'Balık',
        'salmon': 'Somon',
        'tuna': 'Ton Balığı',
        'seaweed': 'Deniz Yosunu',
        'tofu': 'Soya Peyniri (Tofu)',
        'sesame seeds': 'Susam',
        'lemon': 'Limon',
        'lime': 'Misket Limonu',
        'chili': 'Acı Biber',
        'chili flakes': 'Pul Biber',
        'paste': 'Macun / Salça'
    };

    const PROTECTED_TERMS = ['kimchi', 'gochujang', 'miso', 'gochugaru', 'tteokbokki', 'katsu', 'bulgogi', 'bibimbap'];

    const translateIngredient = (name) => {
        if (!name || language === 'EN') return name;
        const lowerName = name.toLowerCase().trim();
        if (PROTECTED_TERMS.some(term => lowerName.includes(term))) return name;

        if (DICTIONARY[lowerName]) return DICTIONARY[lowerName];

        for (const [en, tr] of Object.entries(DICTIONARY)) {
            if (lowerName.includes(en)) {
                return lowerName.replace(en, tr);
            }
        }
        return name;
    };

    const value = {
        theme, setTheme,
        language, setLanguage,
        unitSystem, setUnitSystem,
        country,
        setCountry,
        mainPortionSize,
        setMainPortionSize,
        sidePortionSize,
        setSidePortionSize,
        starterPortionSize,
        setStarterPortionSize,
        prepMainPortionSize,
        setPrepMainPortionSize,
        prepStarterPortionSize,
        setPrepStarterPortionSize,
        prepComponentPortionSize,
        setPrepComponentPortionSize,
        prepDipPortionSize,
        setPrepDipPortionSize,
        prepMarinadePortionSize,
        setPrepMarinadePortionSize,
        volumeFocus,
        setVolumeFocus,
        portionsPerBatch,
        setPortionsPerBatch,
        batchSettings,
        setBatchSettings,
        translateIngredient,
        toggleTheme: () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')
    };

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
};
