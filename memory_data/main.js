(() => {
    "use strict";

    /**
     * @param {Record<string, any>} values
     */
    function formatHash(values) {
        return `#${Object.entries(values)
            .map(([key, value]) => `${key}=${value}`)
            .join("&")}`;
    }

    function generateData() {
        const desktop = desktopCheckbox.checked;
        const metric = metricSelect.value;
        const mobile = mobileCheckbox.checked;
        const variance = varianceCheckbox.checked;

        const labelPrev = {};
        const labelRefs = {};
        const labelMap = new Map();
        const datasetMap = new Map();
        let nextLabelIndex = 0;
        for (const memoryData of LOG_DATA) {
            const source = LOG_SOURCES[memoryData.source];
            if ((memoryData.isMobile && !mobile) || (!memoryData.isMobile && !desktop)) {
                continue;
            }
            const suiteName = memoryData.isMobile
                ? `${memoryData.suite} (mobile)`
                : memoryData.suite;
            if (!labelMap.has(suiteName)) {
                labelMap.set(suiteName, nextLabelIndex++);
            }
            let value = memoryData[metric];
            if (metric === "time") {
                if (memoryData.source in labelRefs) {
                    value -= labelRefs[memoryData.source];
                } else {
                    labelRefs[memoryData.source] = value;
                    value = 0;
                }
            }
            if (variance) {
                [value, labelPrev[memoryData.source]] = [
                    Math.abs(value - (labelPrev[memoryData.source] || 0)),
                    value,
                ];
            }
            if (!datasetMap.has(source)) {
                datasetMap.set(source, {
                    firstTest: suiteName,
                    lastTest: null,
                    size: 0,
                    data: [],
                });
            }
            const dataset = datasetMap.get(source);
            dataset.lastTest = suiteName;
            dataset.data[labelMap.get(suiteName)] = value;
            dataset.size++;
        }

        const labelList = Array.from(labelMap.keys());
        const data = {
            datasets: Array.from(datasetMap.entries(), ([source, dataset]) => ({
                label: source,
                afterLabel: `${trimSuite(dataset.firstTest)} → ${trimSuite(dataset.lastTest)} (${
                    dataset.size
                })`,
                data: dataset.data,
            })),
            labels: labelList,
        };

        console.debug("[GENERATE]", data);

        return data;
    }

    /**
     * @param {string} id
     * @param {string} property
     */
    function getAndBind(id, property) {
        /** @type {any} */
        const el = document.getElementById(id);
        el.addEventListener("change", function onChange(ev) {
            location.hash = formatHash({
                ...parseHash(location.hash),
                [id]: ev.currentTarget[property],
            });
        });
        return el;
    }

    function onLegendClick({ native: ev }, legendItem, { chart }) {
        const hiddenValue = !legendItem.hidden;
        if (ev.ctrlKey && legendItem.text instanceof MemoryDataSource) {
            const source = legendItem.text;
            return window.open(source.getUrl(), "_blank");
        } else if (ev.altKey) {
            const { datasets } = chart.data;
            for (let i = 0; i < datasets.length; i++) {
                chart.getDatasetMeta(i).hidden = hiddenValue;
            }
        } else {
            chart.getDatasetMeta(legendItem.datasetIndex).hidden = hiddenValue;
        }
        chart.update();
    }

    function onHashChange() {
        updateFiltersFromHash();
        update();
    }

    let updating = 0;
    function onResize() {
        if (updating) {
            cancelAnimationFrame(updating);
        }
        updating = requestAnimationFrame(update);
    }

    /**
     * @param {string} hash
     */
    function parseHash(hash) {
        if (hash.startsWith("#")) {
            hash = hash.slice(1);
        }
        /** @type {Record<string, any>} */
        const values = {};
        for (const part of hash.split("&")) {
            const [key, value] = part.split("=");
            if (!key) {
                continue;
            }
            /** @type {string | number | boolean} */
            let parsedValue = value.trim() || "true";
            if (R_TRUTHY.test(parsedValue)) {
                parsedValue = true;
            } else if (R_FALSY.test(parsedValue)) {
                parsedValue = false;
            } else if (!isNaN(Number(parsedValue))) {
                parsedValue = Number(parsedValue);
            }
            values[key.trim()] = parsedValue;
        }
        return values;
    }

    function parseSources(sources) {
        for (const source of Object.values(sources)) {
            sources[source.id] = new MemoryDataSource(source);
        }
        return sources;
    }

    /**
     * @param {string} suite
     */
    function trimSuite(suite) {
        const parts = suite.split("/");
        return parts.length > 2 ? parts.shift() + "/../" + parts.pop() : parts.join("/");
    }

    function update() {
        updating = 0;
        Object.assign(chart.data, generateData());
        chart.update();
    }

    function updateFiltersFromHash() {
        const hashValues = parseHash(location.hash);
        if ("desktop" in hashValues) {
            desktopCheckbox.checked = hashValues.desktop;
        }
        if ("metric" in hashValues) {
            metricSelect.value = hashValues.metric;
        }
        if ("mobile" in hashValues) {
            mobileCheckbox.checked = hashValues.mobile;
        }
        if ("variance" in hashValues) {
            varianceCheckbox.checked = hashValues.variance;
        }
    }

    class MemoryDataSource extends String {
        constructor(values) {
            super(values?.label || "unknown");

            this.url = values?.url || "about:blank";
            if (values?.parent) {
                this.parent = values.parent;
            }
        }

        getUrl() {
            return this.parent ? LOG_SOURCES[this.parent].getUrl() : this.url;
        }
    }

    const canvas = document.getElementById("chart-canvas");

    const R_FALSY = /(false|0)/i;
    const R_TRUTHY = /(true|1)/i;

    /** @type {HTMLInputElement} */
    const desktopCheckbox = getAndBind("desktop", "checked");
    /** @type {HTMLSelectElement} */
    const metricSelect = getAndBind("metric", "value");
    /** @type {HTMLInputElement} */
    const mobileCheckbox = getAndBind("mobile", "checked");
    /** @type {HTMLInputElement} */
    const varianceCheckbox = getAndBind("variance", "checked");

    updateFiltersFromHash();

    // @ts-ignore
    const LOG_DATA = window.LOG_DATA || [];
    // @ts-ignore
    const LOG_SOURCES = parseSources(window.LOG_SOURCES || {});

    // @ts-ignore
    const chart = new Chart(canvas, {
        type: "line",
        data: generateData(),
        options: {
            animation: false,
            elements: {
                line: { borderWidth: 1 },
                point: { radius: 1 },
            },
            interaction: {
                intersect: false,
                mode: "index",
            },
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    onClick: onLegendClick,
                },
                tooltip: {
                    callbacks: {
                        afterLabel: ({ dataset }) => dataset.afterLabel,
                    },
                },
                zoom: {
                    zoom: {
                        wheel: { enabled: true },
                        pinch: { enabled: true },
                        mode: "x",
                    },
                },
            },
            responsive: true,
        },
    });

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("resize", onResize);
})();
