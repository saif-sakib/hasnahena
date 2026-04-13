package models

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email,omitempty"`
	Phone        string `json:"phone"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"`
	Status       string `json:"status"`
	NameEn       string `json:"name"`
	MustChangePassword bool `json:"mustChangePassword"`
}

type LoginRequest struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

type LoginData struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	ExpiresIn   int64  `json:"expiresIn"`
	User        User   `json:"user"`
}

type ForgotPasswordRequest struct {
	Identifier string `json:"identifier"` // Email or Phone
	Locale     string `json:"locale"`     // Defaults to "en"
}

type ResetPasswordRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}
