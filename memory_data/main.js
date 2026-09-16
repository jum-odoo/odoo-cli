(() => {
    "use strict";

    /**
     * @param {string} name
     */
    function bindFormControl(name) {
        const [el] = document.getElementsByName(name);
        const property = el.type === "checkbox" ? "checked" : "value";
        formControls.push(el);
        el.addEventListener("change", function onChange(ev) {
            location.hash = formatHash({
                ...parseHash(location.hash),
                [name]: ev.currentTarget[property],
            });
        });
        return el;
    }

    /**
     * @param {Record<string, any>} values
     */
    function formatHash(values) {
        return (
            "#" +
            Object.entries(values)
                .reduce(
                    (acc, [key, value]) => (value === "" ? acc : acc.concat([`${key}=${value}`])),
                    []
                )
                .join("&")
        );
    }

    function generateData() {
        const filter = filterInput.value;
        const metric = metricSelect.value;
        const showDesktop = showDesktopInput.checked;
        const showMobile = showMobileInput.checked;
        const showVariance = showVarianceInput.checked;

        const nFilter = filter.trim().toLowerCase();

        const labelPrev = {};
        const labelRefs = {};
        const labelMap = new Map();
        const datasetMap = new Map();
        let nextLabelIndex = 0;
        for (const memoryData of LOG_DATA) {
            const source = LOG_SOURCES[memoryData.source];
            if ((memoryData.isMobile && !showMobile) || (!memoryData.isMobile && !showDesktop)) {
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
            if (showVariance) {
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
            dataset.size++;
            if (!nFilter || suiteName.toLowerCase().includes(nFilter)) {
                dataset.data[labelMap.get(suiteName)] = value;
            }
        }

        const labelList = Array.from(labelMap.keys());
        const data = {
            datasets: Array.from(datasetMap.entries(), ([source, dataset]) => ({
                label: source,
                afterLabel: `${trimSuite(dataset.firstTest)} → ${trimSuite(dataset.lastTest)} (${
                    dataset.size
                })`,
                data: dataset.data,
                ...getColor(source),
            })),
            labels: labelList,
        };

        console.debug("[GENERATE]", data);

        return data;
    }

    /**
     * @param {string} label
     */
    function getColor(label) {
        const strLabel = String(label);
        if (!colorsByLabel[strLabel]) {
            colorsByLabel[strLabel] = COLORS[nextColorIndex++ % COLORS.length];
        }
        return colorsByLabel[strLabel];
    }

    function onHashChange() {
        updateFiltersFromHash();
        update();
    }

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
            if (RE_TRUTHY.test(parsedValue)) {
                parsedValue = true;
            } else if (RE_FALSY.test(parsedValue)) {
                parsedValue = false;
            } else if (!isNaN(Number(parsedValue))) {
                parsedValue = Number(parsedValue);
            }
            values[key.trim()] = parsedValue;
        }
        return values;
    }

    /**
     * @param {Record<string, Object>} sources
     */
    function parseSources(sources) {
        for (const source of Object.values(sources)) {
            sources[source.id] = new MemoryDataSource(source);
        }
        return sources;
    }

    /**
     * @param {any[]} list
     */
    function shuffle(list) {
        for (let i = 0; i < list.length; i++) {
            const j = Math.floor(Math.random() * (list.length - i)) + i;
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
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
        if (chart) {
            const hiddenDatasetLabels = new Set();
            const oldDatasets = chart.data.datasets;
            for (let i = 0; i < oldDatasets.length; i++) {
                if (chart.getDatasetMeta(i).hidden) {
                    hiddenDatasetLabels.add(oldDatasets[i].label);
                }
            }
            Object.assign(chart.data, generateData());
            const newDatasets = chart.data.datasets;
            for (let i = 0; i < newDatasets.length; i++) {
                if (hiddenDatasetLabels.has(newDatasets[i].label)) {
                    chart.getDatasetMeta(i).hidden = true;
                }
            }
            chart.update();
        } else {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;

            const ctx = canvas.getContext("2d");
            const text = "No data :(";
            const textHeight = canvas.height * 0.1;
            ctx.font = `italic ${textHeight}px Arial`;
            const textWidth = ctx.measureText(text).width;
            ctx.fillStyle = "#c0c0c0";
            ctx.fillText(
                text,
                canvas.width / 2 - textWidth / 2,
                canvas.height / 2 - textHeight / 2
            );
        }
    }

    function updateFiltersFromHash() {
        const hashValues = parseHash(location.hash);
        for (const el of formControls) {
            const name = el.getAttribute("name");
            if (name in hashValues) {
                switch (el.getAttribute("type")) {
                    case "checkbox": {
                        el.checked = Boolean(hashValues[name]);
                        break;
                    }
                    default: {
                        const value = hashValues[name];
                        el.value = typeof value === "string" ? value : "";
                        break;
                    }
                }
            }
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

    /** @type {ChartOptions} */
    const CHART_OPTIONS = {
        animation: false,
        elements: {
            line: { borderWidth: 2 },
            point: { radius: 1 },
        },
        interaction: {
            intersect: false,
            mode: "index",
        },
        maintainAspectRatio: false,
        plugins: {
            legend: {
                onClick({ native: ev }, legendItem, { chart }) {
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
                },
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
    };
    const COLORS = shuffle(
        [
            [88.5, 0.062, 18.334],
            [70.4, 0.191, 22.216],
            [90.1, 0.076, 70.697],
            [75, 0.183, 55.934],
            [92.4, 0.12, 95.746],
            [82.8, 0.189, 84.429],
            [94.5, 0.129, 101.54],
            [85.2, 0.199, 91.936],
            [93.8, 0.127, 124.321],
            [84.1, 0.238, 128.85],
            [92.5, 0.084, 155.995],
            [79.2, 0.209, 151.711],
            [90.5, 0.093, 164.15],
            [76.5, 0.177, 163.223],
            [91, 0.096, 180.426],
            [77.7, 0.152, 181.912],
            [91.7, 0.08, 205.041],
            [78.9, 0.154, 211.53],
            [90.1, 0.058, 230.902],
            [74.6, 0.16, 232.661],
            [88.2, 0.059, 254.128],
            [70.7, 0.165, 254.624],
            [87, 0.065, 274.039],
            [67.3, 0.182, 276.935],
            [89.4, 0.057, 293.283],
            [70.2, 0.183, 293.541],
            [90.2, 0.063, 306.703],
            [71.4, 0.203, 305.504],
            [90.3, 0.076, 319.62],
            [74, 0.238, 322.16],
            [89.9, 0.061, 343.231],
            [71.8, 0.202, 349.761],
            [89.2, 0.058, 10.001],
            [71.2, 0.194, 13.428],
        ].map(([L, C, H]) => ({
            backgroundColor: `oklch(${L}% ${C} ${H})`,
            borderColor: `oklch(${L - 5}% ${C} ${H})`,
            color: `oklch(${L - 5}% ${C} ${H})`,
        }))
    );

    const RE_FALSY = /(false|0)/i;
    const RE_TRUTHY = /(true|1)/i;

    const colorsByLabel = {};

    /** @type {HTMLCanvasElement} */
    const canvas = document.getElementById("chart-canvas");
    const formControls = [];

    /** @type {HTMLInputElement} */
    const filterInput = bindFormControl("filter");
    /** @type {HTMLSelectElement} */
    const metricSelect = bindFormControl("metric");
    /** @type {HTMLInputElement} */
    const showDesktopInput = bindFormControl("desktop");
    /** @type {HTMLInputElement} */
    const showMobileInput = bindFormControl("mobile");
    /** @type {HTMLInputElement} */
    const showVarianceInput = bindFormControl("variance");

    updateFiltersFromHash();

    // @ts-ignore
    const LOG_DATA = window.LOG_DATA || [];
    // @ts-ignore
    const LOG_SOURCES = parseSources(window.LOG_SOURCES || {});

    let chart;
    let nextColorIndex = 0;
    let updating = 0;
    if (LOG_DATA.length) {
        // @ts-ignore
        chart = new Chart(canvas, {
            type: "line",
            data: generateData(),
            options: CHART_OPTIONS,
        });
    } else {
        update();
    }

    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("resize", onResize);
})();
