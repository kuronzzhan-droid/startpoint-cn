import React, { useState, useEffect } from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ConfigProvider, theme as antdTheme } from "antd"
import zhCN from "antd/locale/zh_CN"
import App from "./App"
import "./styles.css"

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false }
    }
})

function Root() {
    const [dark, setDark] = useState(true)

    useEffect(() => {
        document.documentElement.dataset.adminTheme = dark ? "dark" : "light"
        document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }, [dark])

    return (
        <QueryClientProvider client={queryClient}>
            <ConfigProvider
                locale={zhCN}
                theme={{
                    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
                    token: {
                        colorPrimary: dark ? "#39d9e6" : "#087f83",
                        colorInfo: dark ? "#6ba9ff" : "#1f63b8",
                        colorSuccess: dark ? "#65eca7" : "#1f7a4f",
                        colorWarning: dark ? "#ffc15d" : "#9a5b00",
                        colorError: dark ? "#ff6c9d" : "#c72e5a",
                        colorBgLayout: "transparent",
                        colorBgContainer: dark ? "#10182a" : "#ffffff",
                        colorBgElevated: dark ? "#16223a" : "#ffffff",
                        colorBorder: dark ? "#263a5b" : "#c7d3e3",
                        colorText: dark ? "#f7fbff" : "#172033",
                        colorTextSecondary: dark ? "#aebbd2" : "#58677c",
                        borderRadius: 6,
                        borderRadiusLG: 8,
                        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    },
                    components: {
                        Button: {
                            borderRadius: 6,
                            controlHeight: 34,
                        },
                        Card: {
                            borderRadiusLG: 8,
                            headerFontSize: 15,
                        },
                        Table: {
                            borderColor: dark ? "#263a5b" : "#c7d3e3",
                            headerBg: dark ? "#16223a" : "#f3f7fb",
                        },
                    },
                }}
            >
                <BrowserRouter basename="/admin">
                    <App dark={dark} onToggleDark={() => setDark(d => !d)} />
                </BrowserRouter>
            </ConfigProvider>
        </QueryClientProvider>
    )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>
)
