import LoginForm from "../../components/_auth/loginForm"
import "../../static/css/_auth/index_login.css"

function App() {
    return (
        <div className="login-page">
            <div className="form-container">
                <LoginForm />
            </div>
        </div>
    )
}

export default App
